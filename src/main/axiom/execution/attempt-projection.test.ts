import { afterEach, expect, it, vi } from 'vitest'
import { projectOrchestrationFleet } from '../../../shared/orchestration-fleet-projection'
import { fixture } from '../mission-controller/controller-fixture.test-support'
import { projectAttempt } from './attempt-projection'
const f = fixture()
afterEach(() => f.db.close())
it('projects pending admission and folds kernel resource/liveness without inventing a verdict', () => {
  f.store.insertAttemptBinding({
    taskId: 'task',
    missionId: 'mission',
    seq: 1,
    branch: 'branch',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  const binding = f.store.getAttemptBinding('task', 1)!
  const projectWorker = vi.fn(
    () =>
      projectOrchestrationFleet({
        workers: [
          {
            dispatchId: 'd1',
            taskId: 'task',
            runId: 'run',
            parentTaskId: null,
            workerState: 'ready',
            dispatchStatus: 'active',
            workerStage: 'ready',
            agentTerminalHandle: 'term',
            paneKey: null,
            worktreeId: 'wt',
            terminalState: null,
            resource: null
          }
        ],
        statuses: []
      }).workers[0]
  )
  expect(projectAttempt(f.store, binding, projectWorker)).toMatchObject({
    attemptId: null,
    state: 'LAUNCH_PENDING',
    liveness: null,
    workspace: null,
    worktreeId: null
  })
  expect(projectWorker).not.toHaveBeenCalled()
  const bound = { ...binding, dispatchId: 'd1' }
  expect(projectAttempt(f.store, bound, () => null)).toMatchObject({
    state: 'START_UNKNOWN',
    liveness: null,
    workspace: null
  })
  expect(projectAttempt(f.store, bound, projectWorker)).toMatchObject({
    state: 'RUNNING',
    liveness: 'unverifiable',
    workspace: null,
    worktreeId: 'wt'
  })
  const worker = projectWorker()
  for (const releaseState of [
    'retained',
    'released',
    'not_requested',
    'requested',
    'releasing',
    'unknown'
  ]) {
    projectWorker.mockReturnValue({
      ...worker,
      resource: {
        state: 'owned',
        id: 'r',
        ownerDispatchId: 'd1',
        releaseState,
        terminalState: null
      }
    })
    expect(projectAttempt(f.store, bound, projectWorker).workspace).toBe(
      ['retained', 'released'].includes(releaseState) ? releaseState : 'pending'
    )
  }
})
