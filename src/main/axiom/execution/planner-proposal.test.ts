import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { PLANNER_STOP_GRACE_MS } from './planner-proposal'
import * as plannerStop from './planner-stop'
import { RecoveryService } from '../recovery/recovery-service'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import * as stop from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import * as release from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'

let f: Awaited<ReturnType<typeof plannerFixture>>
let attemptId: string
beforeEach(async () => {
  f = await plannerFixture()
  attemptId = (await createPlannerLauncher(f.deps).start(f.mission.id)).attempt.attemptId!
  vi.spyOn(stop, 'stopLocalWorker').mockImplementation(async () => {
    f.db.beginWorkerStop(attemptId, f.runtime.getRuntimeId())
    f.db.settleWorkerStop(attemptId)
    return { state: 'stopped' }
  })
  vi.spyOn(release, 'releaseLocalWorker').mockResolvedValue({
    dispatchId: attemptId,
    state: 'released',
    processAction: 'none',
    archive: null
  })
  vi.useFakeTimers()
})
afterEach(async () => {
  vi.clearAllTimers()
  vi.useRealTimers()
  await f.close()
})
function propose(envelope = {}) {
  const { provenance: _provenance, ...planRevision } = makeProposal()
  return f.call(
    'axiom.plan.propose',
    {
      missionId: f.mission.id,
      attemptId,
      from: f.from,
      planRevision: {
        ...planRevision,
        goalRevisionId: f.goalRevision.id,
        tasks: planRevision.tasks.map((t) => ({ ...t, role: 'implementer' }))
      }
    },
    envelope
  )
}
it('replays a bound Planner proposal once and refuses a replaced process before receipt lookup', async () => {
  const envelope = { orchestrationRequestId: 'planner-retry' }
  expect(await propose(envelope)).toMatchObject({ ok: true })
  const plans = f.missions.listPlans(f.mission.id)
  const audit = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(await propose(envelope)).toMatchObject({
    ok: true,
    result: { mutation: { replayed: true } }
  })
  vi.spyOn(f.runtime, 'getTerminalProcessIncarnation').mockReturnValue('another-process')
  expect(await propose(envelope)).toMatchObject({
    ok: false,
    error: { code: 'worker_identity_changed' }
  })
  expect(f.missions.listPlans(f.mission.id)).toEqual(plans)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(audit)
})
it('rejects a dirty planner worktree before any Plan or Mission change', async () => {
  f.gitRun.mockResolvedValue({ stdout: ' M src/file.ts\n?? proposal.json\n', stderr: '' })
  expect(await propose()).toMatchObject({
    ok: false,
    error: {
      code: 'planner_worktree_dirty',
      data: { files: [' M src/file.ts', '?? proposal.json'] }
    }
  })
  expect(f.gitRun).toHaveBeenLastCalledWith(
    ['status', '--porcelain'],
    expect.objectContaining({ cwd: '/fixture/planner' })
  )
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
  expect(f.missions.listPlans(f.mission.id)).toEqual([])
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
  expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)).toMatchObject({
    event: 'planner.rejected',
    after: { reason: 'planner_worktree_dirty', files: [' M src/file.ts', '?? proposal.json'] }
  })
})
it('preserves dirty-file details and the CLI-facing message through RPC', async () => {
  f.gitRun.mockResolvedValue({ stdout: ' M src/file.ts\n', stderr: '' })
  const response = await propose()
  expect(response).toMatchObject({
    ok: false,
    error: {
      code: 'planner_worktree_dirty',
      message: expect.stringContaining(' M src/file.ts'),
      data: { files: [' M src/file.ts'] }
    }
  })
})
it('rejects a missing planner worktree before any Plan or Mission change', async () => {
  vi.spyOn(f.db, 'getWorkerDispatch').mockReturnValue(undefined)
  const before = f.store.listAuditEvents({ missionId: f.mission.id })
  f.gitRun.mockClear()
  expect(await propose()).toMatchObject({
    ok: false,
    error: { code: 'planner_worktree_missing' }
  })
  expect(f.gitRun).not.toHaveBeenCalled()
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
  expect(f.missions.listPlans(f.mission.id)).toEqual([])
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(before)
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
  expect(release.releaseLocalWorker).not.toHaveBeenCalled()
})
it('returns the proposal receipt before stop/release and preserves role through approval/task show', async () => {
  const response = await propose()
  expect(response).toMatchObject({
    ok: true,
    result: {
      planRevision: { provenance: { kind: 'planner', actor: 'codex' }, status: 'PROPOSED' }
    }
  })
  expect(f.missions.getMission(f.mission.id).status).toBe('PLAN_REVIEW')
  const plan = f.missions.listPlans(f.mission.id)[0]
  expect(plan.provenance.model).toBeUndefined()
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
  expect(release.releaseLocalWorker).not.toHaveBeenCalled()
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.proposed',
      objectId: attemptId,
      after: expect.objectContaining({ planRevisionId: plan.id, rootCount: 3 })
    })
  )
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).not.toContainEqual(
    expect.objectContaining({ event: 'planner.stopped' })
  )
  expect(PLANNER_STOP_GRACE_MS).toBe(2_000)
  await vi.advanceTimersByTimeAsync(PLANNER_STOP_GRACE_MS - 1)
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
  expect(release.releaseLocalWorker).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(stop.stopLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(release.releaseLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.stopped',
      objectId: attemptId,
      after: { state: 'stopped', releaseDisposition: 'released', reason: 'plan_proposed' }
    })
  )
  await f.call('axiom.plan.approve', { planRevisionId: plan.id, resolver: 'tester' })
  const tasks = f.missions.listTasks({ missionId: f.mission.id })
  expect(tasks).toHaveLength(plan.tasks.length)
  expect(await f.call('axiom.task.show', { taskId: tasks[0].taskId })).toMatchObject({
    ok: true,
    result: { task: { spec: { role: 'implementer' } } }
  })
})
it.each(['forged', 'inactive', 'non-planner'] as const)(
  'rejects %s authority without state changes',
  async (mode) => {
    if (mode === 'inactive') {
      f.db.failDispatch(attemptId, 'failed', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
    }
    if (mode === 'non-planner') {
      f.db.db
        .prepare('UPDATE attempt_bindings SET branch = ? WHERE dispatch_id = ?')
        .run('axiom/attempt/fake/1', attemptId)
    }
    const before = f.store.listAuditEvents({ missionId: f.mission.id })
    if (mode === 'forged') {
      vi.spyOn(f.runtime, 'getTerminalProcessIncarnation').mockReturnValue('another-process')
    }
    const result = await propose()
    expect(result).toMatchObject({
      ok: false,
      error: {
        code:
          mode === 'forged'
            ? 'worker_identity_changed'
            : mode === 'inactive'
              ? 'inactive_dispatch'
              : 'task_dispatch_mismatch'
      }
    })
    expect(f.missions.listPlans(f.mission.id)).toEqual([])
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(before)
  }
)
it('keeps user proposals unchanged and does not stop any worker', async () => {
  const { provenance: _provenance, ...planRevision } = makeProposal()
  expect(
    await f.call('axiom.plan.propose', {
      missionId: f.mission.id,
      planRevision: { ...planRevision, goalRevisionId: f.goalRevision.id },
      provenance
    })
  ).toMatchObject({ ok: true, result: { planRevision: { provenance } } })
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
})
it('rechecks authority after git IO', async () => {
  f.gitRun.mockImplementationOnce(async () => {
    f.db.failDispatch(attemptId, 'exited during status', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    return { stdout: '', stderr: '' }
  })
  expect(await propose()).toMatchObject({ ok: false, error: { code: 'inactive_dispatch' } })
  expect(f.missions.listPlans(f.mission.id)).toEqual([])
})
it('preserves committed proposal and audits an unknown stop for recovery', async () => {
  vi.mocked(stop.stopLocalWorker).mockResolvedValue({ state: 'stop_unknown' })
  expect(await propose()).toMatchObject({ ok: true })
  await vi.advanceTimersByTimeAsync(PLANNER_STOP_GRACE_MS)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.stopped',
      after: expect.objectContaining({ state: 'stop_unknown' })
    })
  )
})
it('recovers a live planner with a committed proposal when the scheduled stop is lost', async () => {
  expect(await propose()).toMatchObject({ ok: true })
  expect(stop.stopLocalWorker).not.toHaveBeenCalled()
  // Simulate a runtime exit during the grace window: only the durable proposal survives.
  vi.clearAllTimers()
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    status: 'live',
    exact: true,
    terminal: null,
    terminalHandle: null
  })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: f.artifacts
  })
  expect(await recovery.reconcileAttempts()).toMatchObject({
    attempts: [expect.objectContaining({ attemptId, action: 'stopped' })]
  })
  expect(stop.stopLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(release.releaseLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(f.missions.getMission(f.mission.id).status).toBe('PLAN_REVIEW')
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.stopped',
      objectId: attemptId,
      after: { state: 'stopped', releaseDisposition: 'released', reason: 'plan_proposed' }
    })
  )
})
it('logs only planner identities when the scheduled stop fails', async () => {
  vi.spyOn(plannerStop, 'stopPlanner').mockRejectedValue(new Error('sensitive host details'))
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await propose()).toMatchObject({ ok: true })
  expect(warn).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(PLANNER_STOP_GRACE_MS)
  expect(warn).toHaveBeenCalledExactlyOnceWith('[axiom] Planner stop failed', {
    missionId: f.mission.id,
    dispatchId: attemptId
  })
  expect(f.missions.getMission(f.mission.id).status).toBe('PLAN_REVIEW')
  expect(f.missions.listPlans(f.mission.id)).toHaveLength(1)
})
