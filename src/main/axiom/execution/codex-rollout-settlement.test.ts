import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { interruptionFixture, interruptionNow } from './interruption-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from './headless-attempt-watcher'
import { CodexUsageLimits } from '../../codex/codex-usage-limits'
import * as reader from './codex-rollout-limit'
import * as account from './attempt-account'
import { z } from 'zod'
import { AttemptFailureSchema } from '../../../shared/axiom-contract/attempt-failure'

type FsPromisesModule = typeof fs
// Node refuses to spy on a built-in module namespace (Bun allows it): replace the one export.
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<FsPromisesModule>()
  return { ...actual, open: vi.fn(actual.open) }
})

let f: ReturnType<typeof interruptionFixture>
let home: string
const reset = interruptionNow + 8000
const textFailure = { class: 'usage_limit', retryable: true, source: 'text' }
let actualOpen: FsPromisesModule['open']

beforeEach(async () => {
  actualOpen = (await vi.importActual<FsPromisesModule>('node:fs/promises')).open
  vi.mocked(fs.open).mockReset()
  vi.mocked(fs.open).mockImplementation(actualOpen)
  f = interruptionFixture()
  home = await mkdtemp(path.join(os.tmpdir(), 'axiom-rollout-settlement-'))
  f.db.db
    .prepare('UPDATE worker_dispatches SET created_at = ? WHERE dispatch_id = ?')
    .run('2026-11-09 11:59:00', f.t01.attemptId)
  f.store.appendAuditEvent({
    missionId: f.mission.id,
    actor: 'AttemptLauncher',
    event: 'attempt.headless_prepared',
    objectKind: 'attempt',
    objectId: f.t01.attemptId,
    before: null,
    after: { combination: { effective: { codexHome: { kind: 'account', path: home } } } }
  })
  f.setEvents([
    { type: 'thread.started', thread_id: 'fixture-attempt-1' },
    { type: 'turn.failed', error: { message: 'Fixture usage limit reached' } }
  ])
  f.setExit('75')
})

afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  await f.plane.effects.stop()
  vi.clearAllTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
  await rm(home, { recursive: true, force: true })
})

async function rollout(rateLimits: unknown) {
  const date = new Date(interruptionNow)
  const directory = path.join(
    home,
    'sessions',
    String(date.getFullYear()),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  )
  await mkdir(directory, { recursive: true })
  const file = path.join(directory, 'rollout-local-fixture-attempt-1.jsonl')
  await writeFile(
    file,
    `${JSON.stringify({
      type: 'event_msg',
      payload: {
        type: 'token_count',
        info: null,
        rate_limits: rateLimits
      }
    })}\n`
  )
  return file
}

/** Counts only the opens that follow, as a spy created at this point would. */
function openCalls() {
  const open = vi.mocked(fs.open)
  open.mockClear()
  return open
}
function failure() {
  return f.store
    .listAuditEvents({ missionId: f.mission.id })
    .find((event) => event.event === 'attempt.failed')?.after
}
function observedFailure() {
  return z.object({ failure: AttemptFailureSchema }).parse(failure()).failure
}

it('adds the reset time that Codex recorded in its rollout', async () => {
  const readAccount = vi.spyOn(account, 'readAttemptAccount')
  vi.mocked(fs.open).mockImplementation(async (...args) => {
    expect(f.db.db.isTransaction).toBe(false)
    return actualOpen(...args)
  })
  await rollout({
    limit_id: 'codex',
    primary: {
      used_percent: 100,
      window_minutes: 300,
      resets_at: reset / 1000
    },
    secondary: { used_percent: 4, window_minutes: 10080, resets_at: reset / 1000 + 86400 }
  })
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(failure()).toMatchObject({
    failure: {
      ...textFailure,
      window: 'session',
      resetsAt: new Date(reset).toISOString()
    }
  })
  expect(f.effect(1)).toMatchObject({
    status: 'pending',
    dueAt: new Date(reset + 60000).toISOString(),
    payload: {
      resetsAt: new Date(reset).toISOString(),
      account: {
        provider: 'codex',
        key: expect.stringMatching(/^[a-f0-9]{64}$/)
      }
    }
  })
  expect(JSON.stringify(f.effect(1))).not.toContain(home)
  expect(readAccount).toHaveBeenCalledTimes(1)
  expect(observedFailure()).toEqual({
    ...textFailure,
    window: 'session',
    resetsAt: new Date(reset).toISOString()
  })
})

it('keeps the ladder when the rollout shows no spent window', async () => {
  await rollout({ primary: { used_percent: 70, window_minutes: 300, resets_at: reset / 1000 } })
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(observedFailure()).toEqual(textFailure)
  expect(f.effect(1)?.dueAt).toBe('2026-11-09T12:01:00.000Z')
})
it('settles two spent windows at the later reset without naming a window', async () => {
  await rollout({
    primary: { used_percent: 100, window_minutes: 300, resets_at: reset / 1000 },
    secondary: { used_percent: 100, window_minutes: 10080, resets_at: reset / 1000 + 86400 }
  })
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(observedFailure()).toEqual({
    ...textFailure,
    resetsAt: new Date(reset + 86400000).toISOString()
  })
  expect(f.effect(1)?.dueAt).toBe(new Date(reset + 86400000 + 60000).toISOString())
})
it('keeps only the window if a spent window has no reset', async () => {
  await rollout({ primary: { used_percent: 100, window_minutes: 300 } })
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(observedFailure()).toEqual({ ...textFailure, window: 'session' })
  expect(f.effect(1)?.dueAt).toBe('2026-11-09T12:01:00.000Z')
})
it.each([interruptionNow - 1000, interruptionNow, interruptionNow + 8 * 86400000 + 1000])(
  'drops an out-of-bound reset while keeping the kernel window (%s)',
  async (resetAt) => {
    await rollout({
      primary: { used_percent: 100, window_minutes: 300, resets_at: resetAt / 1000 }
    })
    await submitExitedAttempt(f.runtime, f.t01.attemptId)
    expect(observedFailure()).toEqual({ ...textFailure, window: 'session' })
    expect(f.effect(1)?.dueAt).toBe('2026-11-09T12:01:00.000Z')
  }
)
it('accepts a reset exactly eight days ahead', async () => {
  const resetAt = interruptionNow + 8 * 86400000
  await rollout({ primary: { used_percent: 100, window_minutes: 300, resets_at: resetAt / 1000 } })
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(observedFailure()).toEqual({
    ...textFailure,
    window: 'session',
    resetsAt: new Date(resetAt).toISOString()
  })
})
it.each(['missing file', 'missing home', 'unreadable file', 'kernel exception'])(
  'keeps the text-only failure for a %s',
  async (cause) => {
    if (cause !== 'missing file') {
      await rollout({
        primary: { used_percent: 100, window_minutes: 300, resets_at: reset / 1000 }
      })
    }
    if (cause === 'missing home') {
      f.store.appendAuditEvent({
        missionId: f.mission.id,
        actor: 'AttemptLauncher',
        event: 'attempt.headless_prepared',
        objectKind: 'attempt',
        objectId: f.t01.attemptId,
        before: null,
        after: { combination: { effective: {} } }
      })
    } else if (cause === 'unreadable file') {
      vi.mocked(fs.open).mockRejectedValue(new Error('private path and conversation'))
    } else if (cause === 'kernel exception') {
      vi.spyOn(CodexUsageLimits.prototype, 'observe').mockImplementation(() => {
        throw new Error('kernel')
      })
    }
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    expect(observedFailure()).toEqual(textFailure)
    expect(f.effect(1)?.dueAt).toBe('2026-11-09T12:01:00.000Z')
    expect(JSON.stringify(failure())).not.toContain('private path and conversation')
  }
)
it('never lets a rollout decide the failure class', async () => {
  await rollout({ primary: { used_percent: 100, window_minutes: 300, resets_at: reset / 1000 } })
  f.setEvents([
    { type: 'thread.started', thread_id: 'fixture-attempt-1' },
    { type: 'turn.failed', error: { message: 'fixture work failed' } }
  ])
  const read = vi.spyOn(reader, 'readCodexRolloutLimit')
  const open = openCalls()
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
  expect(observedFailure()).toEqual({ class: 'unknown', retryable: false, source: 'absent' })
  expect(read).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
  expect(f.effect(1)).toBeUndefined()
})
it('never opens a rollout for a non-quota Codex interruption', async () => {
  f.setEvents([{ type: 'turn.failed', error: { message: 'Authentication failed' } }])
  const open = openCalls()
  const read = vi.spyOn(reader, 'readCodexRolloutLimit')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(observedFailure()).toEqual({ class: 'permission_error', retryable: true, source: 'text' })
  expect(read).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})
it('never opens a session record for a Claude Worker', async () => {
  f.prepare(f.t01.attemptId, 'claude')
  f.setEvents([
    {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['Fixture usage limit reached'],
      session_id: 'fixture-attempt-1'
    }
  ])
  const open = openCalls()
  const read = vi.spyOn(reader, 'readCodexRolloutLimit')
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(observedFailure()).toEqual(textFailure)
  expect(read).not.toHaveBeenCalled()
  expect(open).not.toHaveBeenCalled()
})
