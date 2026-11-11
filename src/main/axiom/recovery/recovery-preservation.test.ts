import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { attemptBaselineAudit } from '../execution/attempt-fix-launch'
import * as files from '../execution/headless-attempt-files'

let f: Awaited<ReturnType<typeof recoveryPreservationFixture>>
beforeEach(async () => {
  f = await recoveryPreservationFixture()
})
afterEach(async () => {
  await f.cleanup()
})

function continued() {
  const baseline = resolveAttemptBaseline(f.store, { taskId: f.t01.taskId, seq: 2 })
  expect(attemptBaselineAudit(baseline)).toMatchObject({
    kind: 'snapshot',
    strategy: 'continued',
    reason: 'preserved_snapshot',
    previousSeq: 1,
    attemptId: f.t01.attemptId
  })
  return baseline
}

it('preserves a headless Attempt after its runtime budget stop is confirmed', async () => {
  const before = f.audits().length
  expect(await f.recovery.reconcileAttempts()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.recorded().result).toMatchObject({ status: 'preserved', scopePaths: ['partial.ts'] })
  expect(
    f
      .audits()
      .slice(before)
      .map((row) => row.event)
  ).toEqual(['attempt.stopped', 'attempt.preserved', 'task.stage', 'task.stage'])
  expect(f.audits().slice(before)[0]?.after).toMatchObject({ reason: 'runtime_budget_exceeded' })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(await readFile(path.join(f.repo.root, 'partial.ts'), 'utf8')).toContain('partial')
  continued()
})
it('captures the worktree only after the stop is confirmed', async () => {
  vi.mocked(f.runtime.closeTerminal).mockImplementation(async () => {
    expect(await f.repo.git(['for-each-ref', '--format=%(refname)', f.ref])).toBe('')
    expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('stopping')
    await writeFile(path.join(f.repo.root, 'at-close.ts'), 'export const atClose = true\n')
    return { handle: f.t01.from, tabId: 'tab', ptyKilled: true }
  })
  await f.recovery.reconcileAttempts()
  expect(f.recorded().result.status).toBe('preserved')
  expect(await f.repo.git(['show', `${f.ref}:at-close.ts`])).toBe('export const atClose = true')
})
it('neither preserves nor settles while the stop is unconfirmed', async () => {
  vi.mocked(f.runtime.closeTerminal).mockResolvedValue({
    handle: f.t01.from,
    tabId: 'tab',
    ptyKilled: false
  })
  await f.recovery.reconcileAttempts()
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('stop_unknown')
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(await f.repo.git(['for-each-ref', '--format=%(refname)', f.ref])).toBe('')
})
it('preserves a headless Attempt the kernel reports stopped', async () => {
  await stopLocalWorker(f.runtime, f.t01.attemptId)
  const before = f.audits().length
  await f.recovery.reconcileAttempts()
  expect(f.recorded().result.status).toBe('preserved')
  expect(
    f
      .audits()
      .slice(before)
      .map((row) => row.event)
  ).toEqual(['attempt.stopped', 'attempt.preserved', 'task.stage', 'task.stage'])
  expect(f.audits().slice(before)[0]?.after).toMatchObject({ reason: 'kernel_stopped' })
  continued()
  await f.recovery.reconcileAttempts()
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toHaveLength(1)
})
it('preserves a headless Attempt whose process exit recovery found', async () => {
  f.observe('exited')
  const before = f.audits().length
  await f.recovery.reconcileAttempts()
  expect(f.recorded().result.status).toBe('preserved')
  expect(
    f
      .audits()
      .slice(before)
      .map((row) => row.event)
  ).toEqual(['attempt.failed', 'attempt.preserved', 'task.stage', 'task.stage'])
  expect(f.audits().slice(before)[0]?.after).toMatchObject({
    reason: 'process_exited',
    settlement: { kind: 'failed' }
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  continued()
})
async function unusableLaunch(kind: 'missing' | 'unreadable' | 'mismatched') {
  const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
  vi.mocked(files.readHeadlessFile).mockImplementation(async (directory, name) => {
    if (name !== 'launch.json') {
      return read?.(directory, name)
    }
    if (kind === 'missing') {
      return undefined
    }
    if (kind === 'unreadable') {
      throw new Error('unreadable')
    }
    return JSON.stringify({ ...f.launch, branch: 'axiom/attempt/wrong/1' })
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'stopped' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('READY')
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(await f.repo.git(['for-each-ref', '--format=%(refname)', f.ref])).toBe('')
}
it('settles as before when the launch record cannot be used', () => unusableLaunch('missing'))
it.each(['unreadable', 'mismatched'] as const)('settles with a %s launch record', unusableLaunch)
