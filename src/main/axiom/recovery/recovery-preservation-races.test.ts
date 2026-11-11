import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import * as snapshots from '../execution/preserved-snapshot'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { attemptBaselineAudit } from '../execution/attempt-fix-launch'

let f: Awaited<ReturnType<typeof recoveryPreservationFixture>>
beforeEach(async () => {
  f = await recoveryPreservationFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('writes no preservation audit when another path settled the Attempt first', async () => {
  f.observe('exited')
  const preserve = snapshots.preserveAttemptWorktree
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementation(async (input) => {
    expect(f.db.db.isTransaction).toBe(false)
    const captured = await preserve(input)
    expect(await f.submit()).toMatchObject({ ok: true })
    return captured
  })
  await f.recovery.reconcileAttempts()
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
  expect(
    f
      .audits()
      .filter((row) =>
        ['attempt.preserved', 'attempt.failed', 'attempt.stopped'].includes(row.event)
      )
  ).toEqual([])
})

it.each(['kernel', 'exit', 'budget'] as const)(
  'respects Mission cancellation while %s capture is in flight',
  async (kind) => {
    if (kind === 'kernel') {
      await stopLocalWorker(f.runtime, f.t01.attemptId)
    }
    if (kind === 'exit') {
      f.observe('exited')
    }
    const preserve = snapshots.preserveAttemptWorktree
    vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementation(async (input) => {
      expect(f.db.db.isTransaction).toBe(false)
      const captured = await preserve(input)
      f.missions.cancelMission(f.mission.id, 'human')
      return captured
    })
    await f.recovery.reconcileAttempts()
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('CANCELED')
    expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
    expect(
      f
        .audits()
        .filter((row) => ['attempt.stopped', 'attempt.failed'].includes(row.event))
        .map((row) => row.after)
    ).toEqual(kind === 'exit' ? [] : [expect.objectContaining({ reason: 'mission_canceled' })])
  }
)

it('repairs a crash between confirmed stop and settlement using the same published snapshot', async () => {
  const transaction = f.store.transaction.bind(f.store)
  const crash = vi.spyOn(f.store, 'transaction').mockImplementation((name, run) => {
    if (name === 'recovery_runtime_budget') {
      throw new Error('simulated crash')
    }
    return transaction(name, run)
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('stopped')
  const commitSha = await f.repo.git(['rev-parse', f.ref])
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  crash.mockRestore()
  await writeFile(path.join(f.repo.root, 'later.ts'), 'later disk change\n')
  await f.recovery.reconcileAttempts()
  expect(f.recorded().result).toMatchObject({
    status: 'preserved',
    snapshot: { commitSha },
    scopePaths: ['partial.ts']
  })
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toMatchObject([
    { after: { reason: 'kernel_stopped' } }
  ])
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
})

it('rolls back the recovery ending and preservation audit together', async () => {
  f.observe('exited')
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.preserved') {
      throw new Error('audit unavailable')
    }
    return append(input)
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('ready')
  expect(
    f.audits().filter((row) => ['attempt.preserved', 'attempt.failed'].includes(row.event))
  ).toEqual([])
})

it('preserves a restart exit with the existing refund and continuation ladder', async () => {
  f.observe('exited')
  f.db.db
    .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
    .run('old', f.t01.attemptId)
  const before = f.audits().length
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.effect(1)).toMatchObject({
    status: 'pending',
    payload: { failureClass: 'unknown', chain: 1 }
  })
  const effect = f.effect(1)
  if (!effect) {
    throw new Error('Missing continuation')
  }
  const created = Date.parse(
    f.binding.createdAt.replace(' ', 'T') + (f.binding.createdAt.endsWith('Z') ? '' : 'Z')
  )
  expect(Date.parse(effect.dueAt)).toBe(created + 180_000)
  expect(
    f
      .audits()
      .slice(before)
      .filter((row) => row.objectKind === 'attempt')
      .map((row) => row.event)
  ).toEqual(['attempt.failed', 'attempt.preserved'])
  expect(f.audits().slice(before)[0]?.after).toMatchObject({
    evidence: 'runtime_restarted',
    settlement: { kind: 'interrupted' }
  })
  expect(
    attemptBaselineAudit(resolveAttemptBaseline(f.store, { taskId: f.t01.taskId, seq: 2 }))
  ).toMatchObject({ strategy: 'continued', reason: 'preserved_snapshot' })
})

it('reconciles a changed kernel ending from the top without stale process exit audits', async () => {
  f.observe('exited')
  const preserve = snapshots.preserveAttemptWorktree
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementationOnce(async (input) => {
    const captured = await preserve(input)
    f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
    f.db.settleWorkerStop(f.t01.attemptId)
    return captured
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'attempt_stopped' }]
  })
  expect(f.audits().filter((row) => row.event === 'attempt.failed')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toHaveLength(1)
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toMatchObject([
    { after: { reason: 'kernel_stopped' } }
  ])
})
