import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CodexUsageLimits } from '../../codex/codex-usage-limits'
import { readCodexRolloutLimit } from './codex-rollout-limit'

const now = new Date(2026, 10, 10, 12).getTime()
const reset = now + 8000
const primary = { used_percent: 100, window_minutes: 300, resets_at: reset / 1000 }
let home: string
beforeEach(async () => {
  home = await fs.mkdtemp(path.join(os.tmpdir(), 'axiom-rollout-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(home, { recursive: true, force: true })
})

function record(rate: unknown) {
  return JSON.stringify({ type: 'event_msg', payload: { type: 'token_count', rate_limits: rate } })
}
async function write(text: string, day = now, name = 'rollout-local-thread-1.jsonl') {
  const date = new Date(day)
  const directory = path.join(
    home,
    'sessions',
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  )
  await fs.mkdir(directory, { recursive: true })
  const file = path.join(directory, name)
  await fs.writeFile(file, text)
  return file
}
const read = (overrides: Partial<Parameters<typeof readCodexRolloutLimit>[0]> = {}) =>
  readCodexRolloutLimit({
    accountHome: home,
    threadId: 'thread-1',
    startedAt: now,
    now: () => now,
    ...overrides
  })

it('lets nothing but the limit windows out of a rollout', async () => {
  await write(
    [
      JSON.stringify({ type: 'session_meta', payload: { creator_account_id: 'DECOY_ACCOUNT' } }),
      JSON.stringify({
        type: 'event_msg',
        payload: {
          type: 'token_count',
          info: 'DECOY_INFO',
          rate_limits: {
            limit_id: 'codex',
            primary,
            plan_type: 'free',
            credits: { has_credits: true, balance: 'DECOY_BALANCE' },
            limit_name: 'DECOY_NAME'
          }
        }
      }),
      JSON.stringify({ type: 'response_item', payload: { content: 'DECOY_CONVERSATION' } })
    ].join('\n')
  )
  const observe = vi.spyOn(CodexUsageLimits.prototype, 'observe')
  const result = await read()
  expect(result).toEqual({ window: 'session', resetsAt: reset })
  expect(observe).toHaveBeenCalledExactlyOnceWith('notification:account/rateLimits/updated', {
    rateLimits: {
      limitId: 'codex',
      primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: reset / 1000 },
      secondary: undefined,
      rateLimitReachedType: undefined
    }
  })
  expect(JSON.stringify([result, observe.mock.calls])).not.toMatch(/DECOY|free/)
})
it('ignores a record under another limit id', async () => {
  await write(record({ limit_id: 'another-model', primary }))
  expect(await read()).toBeUndefined()
})
it('keeps null windows when merging later records', async () => {
  await write(
    [
      record({
        primary,
        secondary: { ...primary, window_minutes: 10080, resets_at: reset / 1000 + 86400 }
      }),
      record({ secondary: null })
    ].join('\n')
  )
  expect(await read()).toEqual({ window: 'session', resetsAt: reset })
})
it('uses the later reset when both windows are spent', async () => {
  await write(
    record({
      primary,
      secondary: { ...primary, window_minutes: 10080, resets_at: reset / 1000 + 86400 }
    })
  )
  expect(await read()).toEqual({ resetsAt: reset + 86400000 })
})
it('returns only the window when a spent window has no reset', async () => {
  await write(record({ primary: { used_percent: 100, window_minutes: 300 } }))
  expect(await read()).toEqual({ window: 'session' })
})
it('uses the kernel weekly and credits window names', async () => {
  await write(record({ secondary: { ...primary, window_minutes: 10080 } }))
  expect(await read()).toEqual({ window: 'weekly', resetsAt: reset })
  await write(record({ primary, rate_limit_reached_type: 'plan_credits_depleted' }))
  expect(await read()).toEqual({ window: 'credits', resetsAt: reset })
})
it('uses only token_count rate_limits and skips malformed lines', async () => {
  await write(
    [
      'not JSON',
      '{',
      record({ primary }),
      JSON.stringify({
        type: 'event_msg',
        payload: { type: 'message', rate_limits: { primary: null } }
      }),
      JSON.stringify({
        type: 'response_item',
        payload: { type: 'token_count', rate_limits: { primary: null } }
      }),
      record({ primary: 'malformed' })
    ].join('\n')
  )
  expect(await read()).toEqual({ window: 'session', resetsAt: reset })
})
it.each([
  undefined,
  '',
  '../thread-1',
  'thread/1',
  'thread\\1',
  '..',
  'thread..1',
  'a*',
  '?',
  '[a]',
  'x'.repeat(129)
])('never opens a file for an unsafe or missing thread id (%s)', async (threadId) => {
  const open = vi.spyOn(fs, 'open')
  expect(await read({ threadId })).toBeUndefined()
  expect(open).not.toHaveBeenCalled()
})
it('never follows a symlink out of sessions', async () => {
  const file = await write(record({ primary }))
  const outside = path.join(home, 'outside.jsonl')
  await fs.rename(file, outside)
  await fs.symlink(outside, file)
  const open = vi.spyOn(fs, 'open')
  expect(await read()).toBeUndefined()
  expect(open).not.toHaveBeenCalled()
})
it('never follows a date directory or sessions root out of sessions', async () => {
  const file = await write(record({ primary }))
  const day = path.dirname(file)
  const outside = path.join(home, 'outside')
  await fs.rename(day, outside)
  await fs.symlink(outside, day)
  expect(await read()).toBeUndefined()
  await fs.rm(day)
  await fs.rename(outside, day)
  await fs.rename(path.join(home, 'sessions'), outside)
  await fs.symlink(outside, path.join(home, 'sessions'))
  expect(await read()).toBeUndefined()
})
it('opens only the most recently modified match across the Attempt local days', async () => {
  const older = await write(
    record({ primary: { ...primary, resets_at: reset / 1000 + 1 } }),
    now - 86400000
  )
  const newer = await write(record({ primary }))
  await fs.utimes(older, new Date(now - 2000), new Date(now - 2000))
  await fs.utimes(newer, new Date(now), new Date(now))
  const open = vi.spyOn(fs, 'open')
  expect(await read({ startedAt: now - 86400000 })).toEqual({ window: 'session', resetsAt: reset })
  expect(open).toHaveBeenCalledTimes(1)
  expect(open.mock.calls[0]?.[0]).toBe(await fs.realpath(newer))
})
it('does not search a day before the Attempt or after today', async () => {
  await write(record({ primary }), now - 86400000)
  await write(record({ primary }), now + 86400000)
  expect(await read()).toBeUndefined()
})
it('reads at most the last 256 KiB and drops the leading partial line', async () => {
  const file = await write(
    `${record({ secondary: { ...primary, window_minutes: 10080 } })}\n${'x'.repeat(300000)}\n${record({ primary })}\n`
  )
  const original = fs.open
  let reads: unknown[][] = []
  vi.spyOn(fs, 'open').mockImplementation(async (...args) => {
    const handle = await original(...args)
    reads = vi.spyOn(handle, 'read').mock.calls
    return handle
  })
  expect(await read()).toEqual({ window: 'session', resetsAt: reset })
  expect(reads.map((args) => args.slice(2))).toEqual([
    [256 * 1024, (await fs.stat(file)).size - 256 * 1024]
  ])
})
it('drops an oversized final line with no newline', async () => {
  await write(' '.repeat(300000) + record({ primary }))
  expect(await read()).toBeUndefined()
})
it('returns no evidence for absent, unreadable or wholly malformed files', async () => {
  expect(await read()).toBeUndefined()
  expect(await read({ accountHome: undefined })).toBeUndefined()
  expect(await read({ accountHome: path.join(home, 'missing') })).toBeUndefined()
  await write('{malformed\nnull\n')
  expect(await read()).toBeUndefined()
  await write(record({ primary }))
  vi.spyOn(fs, 'open').mockRejectedValue(new Error('private file error'))
  expect(await read()).toBeUndefined()
})
it('returns no evidence if the kernel throws', async () => {
  await write(record({ primary }))
  vi.spyOn(CodexUsageLimits.prototype, 'failure').mockImplementation(() => {
    throw new Error('kernel')
  })
  expect(await read()).toBeUndefined()
})
