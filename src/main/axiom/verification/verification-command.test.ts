import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import childProcess from 'node:child_process'
import { spawnLocalShellCommand } from '../../automations/precheck-runner'
import { runVerificationCommand } from './verification-command'

let cwd: string
beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'axiom-check-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(cwd, { recursive: true, force: true })
})
const run = (
  command: string,
  options: {
    deadline?: number
    signal?: AbortSignal
    spawnCommand?: typeof spawnLocalShellCommand
  } = {}
) => runVerificationCommand({ command, cwd, deadline: Date.now() + 10_000, ...options })

function unspawnedChild() {
  const child = new childProcess.ChildProcess()
  // Bun exposes these as native getters that require an actual spawn handle.
  Object.defineProperties(child, { stdout: { value: null }, stderr: { value: null } })
  return child
}

it('records actual process exits and streams', async () => {
  const result = await run('node -e "console.log(123); console.error(456)"')
  expect(result).toMatchObject({
    result: 'pass',
    exitCode: 0,
    signal: null,
    stdout: { content: '123\n' },
    stderr: { content: '456\n' }
  })
  expect(await run('node -e "process.exit(2)"')).toMatchObject({ result: 'fail', exitCode: 2 })
})
it.each(['ENOENT', 'EACCES'])('classifies spawn %s as tool_missing', async (code) => {
  const spawnCommand = vi.fn(() => {
    throw Object.assign(new Error('missing'), { code })
  })
  expect(await run('node -e ""', { spawnCommand })).toMatchObject({
    result: 'environmental',
    reason: 'tool_missing',
    exitCode: null
  })
})
it('classifies a missing shell command and native missing-command codes', async () => {
  expect(await run('axiom_nonexistent_check_74023')).toMatchObject({
    result: 'environmental',
    reason: 'tool_missing'
  })
  expect(await run('node -e "process.exit(127)"')).toMatchObject({
    result: 'environmental',
    reason: 'tool_missing'
  })
})
it.each([
  { code: 9009, signal: null, reason: 'tool_missing' },
  { code: null, signal: 'SIGTERM', reason: 'killed' }
])(
  'classifies close $code / $signal without platform assumptions',
  async ({ code, signal, reason }) => {
    const spawnCommand = vi.fn(() => {
      const child = unspawnedChild()
      queueMicrotask(() => child.emit('close', code, signal))
      return child
    })
    expect(await run('check', { spawnCommand })).toMatchObject({
      result: 'environmental',
      reason,
      exitCode: code,
      signal
    })
  }
)
it('handles asynchronous spawn errors without hanging', async () => {
  const spawnCommand = vi.fn(() => {
    const child = unspawnedChild()
    queueMicrotask(() => {
      child.emit('error', Object.assign(new Error('not executable'), { code: 'EACCES' }))
      child.emit('close', null, null)
    })
    return child
  })
  expect(await run('check', { spawnCommand })).toMatchObject({
    result: 'environmental',
    reason: 'tool_missing',
    exitCode: null
  })
  expect(spawnCommand).toHaveBeenCalledWith('check', cwd)
})
it('kills a timed-out command tree and never starts an exhausted command', async () => {
  expect(
    await run('node -e "setInterval(() => {}, 100)"', { deadline: Date.now() + 100 })
  ).toMatchObject({
    result: 'environmental',
    reason: 'timeout'
  })
  const spawnCommand = vi.fn(spawnLocalShellCommand)
  expect(
    await run('node -e "process.exit(1)"', { deadline: Date.now() - 1, spawnCommand })
  ).toMatchObject({
    result: 'skipped',
    reason: 'time_budget_exhausted'
  })
  expect(spawnCommand).not.toHaveBeenCalled()
})
it('stops a running command when the plane aborts', async () => {
  const abort = new AbortController()
  const result = run('node -e "setInterval(() => {}, 100)"', { signal: abort.signal })
  abort.abort()
  expect(await result).toMatchObject({ result: 'environmental', reason: 'killed' })
})
