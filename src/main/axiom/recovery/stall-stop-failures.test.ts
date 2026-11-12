import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { supervisionFixture } from './supervision-fixture.test-support'
import * as snapshots from '../execution/preserved-snapshot'

let f: Awaited<ReturnType<typeof supervisionFixture>>
beforeEach(async () => {
  f = await supervisionFixture()
  f.budget()
  f.e2e(true)
  vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
  f.events(f.now() - 2000)
  f.store.appendSupervisionSetting({
    rule: 'stalled',
    missionId: f.mission.id,
    mode: 'stop',
    actor: 'user'
  })
})
afterEach(async () => {
  await f.cleanup()
})

it('skips the stall rule on a mode read error while still enforcing timeout', async () => {
  vi.spyOn(f.store, 'getSupervisionSetting').mockImplementation(() => {
    throw new Error('settings unavailable')
  })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'unchanged' }] })
  expect(f.rule('stalled')).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
  f.budget(1)
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.rule('timeout')).toHaveLength(1)
})

it('rolls back the stalled supervision audit and Task settlement together', async () => {
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.preserved') {
      throw new Error('audit unavailable')
    }
    return append(input)
  })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'reconcile_failed' }] })
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('stopped')
  expect(f.rule('stalled')).toEqual([])
  expect(
    f.audits().filter((row) => ['attempt.stopped', 'attempt.preserved'].includes(row.event))
  ).toEqual([])
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
})

it('reconciles cancellation during stall preservation without a stale stall settlement', async () => {
  const preserve = snapshots.preserveAttemptWorktree
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementation(async (input) => {
    const captured = await preserve(input)
    f.missions.cancelMission(f.mission.id, 'human')
    return captured
  })
  await f.tick()
  expect(f.stop).toHaveBeenCalledOnce()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('CANCELED')
  expect(f.rule('stalled')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
})

it('does not settle a stall stop after a concurrent Submission', async () => {
  // Submission wins while the host stop is in flight; its late receipt is stale.
  f.stop.mockImplementationOnce(async () => {
    expect(await f.submit()).toMatchObject({ ok: true })
    return { dispatchId: f.t01.attemptId, state: 'stopped' }
  })
  await f.tick()
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
  expect(f.rule('stalled')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
})

it('counts a stalled stop toward the exhausted retry budget', async () => {
  f.db.db
    .prepare('UPDATE task_stages SET retry_policy = ? WHERE task_id = ?')
    .run(JSON.stringify({ maxAttempts: 1 }), f.t01.taskId)
  await f.tick()
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'BLOCKED', attemptCount: 1 })
  expect(f.audits().findLast((row) => row.event === 'task.stage')).toMatchObject({
    after: { reason: 'retry_budget_exhausted' }
  })
})
