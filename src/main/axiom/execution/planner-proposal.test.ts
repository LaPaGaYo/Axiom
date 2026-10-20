import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import * as stop from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import * as release from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'

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
})
afterEach(async () => {
  await f.close()
})
function propose(envelope = { orchestrationCapability: f.capability() }) {
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
it('stamps planner provenance, settles then stops/releases, and preserves role through approval/task show', async () => {
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
  expect(stop.stopLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(release.releaseLocalWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, attemptId)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.proposed',
      objectId: attemptId,
      after: expect.objectContaining({ planRevisionId: plan.id, rootCount: 3 })
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
    const result = await propose({
      orchestrationCapability: mode === 'forged' ? 'dcap_forged' : f.capability()
    })
    expect(result).toMatchObject({
      ok: false,
      error: {
        code:
          mode === 'forged'
            ? 'dispatch_capability_invalid'
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
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'planner.stopped',
      after: expect.objectContaining({ state: 'stop_unknown' })
    })
  )
})
