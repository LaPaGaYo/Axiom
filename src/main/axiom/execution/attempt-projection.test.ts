import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { AttemptSummarySchema } from '../../../shared/axiom-contract/attempt-params'
import { projectOrchestrationFleet } from '../../../shared/orchestration-fleet-projection'
import { fixture } from '../mission-controller/controller-fixture.test-support'
import { projectAttempt } from './attempt-projection'
let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
  f.store.insertAttemptBinding({
    taskId: 'task',
    missionId: 'mission',
    seq: 1,
    branch: 'branch',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
})
afterEach(() => f.db.close())

function fleetWorker() {
  return projectOrchestrationFleet({
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
}

it('leaves pending admission uninspected with null liveness and workspace', async () => {
  const projectWorker = vi.fn(fleetWorker)
  const inspectTerminal = vi.fn<(dispatchId: string) => ReturnType<typeof inspectWorkerTerminal>>()
  const attempt = await projectAttempt(
    f.store,
    f.store.getAttemptBinding('task', 1)!,
    projectWorker,
    inspectTerminal
  )
  expect(attempt).toMatchObject({
    attemptId: null,
    state: 'LAUNCH_PENDING',
    liveness: null,
    livenessReason: null,
    workspace: null,
    worktreeId: null
  })
  expect(projectWorker).not.toHaveBeenCalled()
  expect(inspectTerminal).not.toHaveBeenCalled()
  const { livenessReason: _reason, ...legacyAttempt } = attempt
  expect(AttemptSummarySchema.safeParse(legacyAttempt).success).toBe(true)
})

it.each<{
  status: Awaited<ReturnType<typeof inspectWorkerTerminal>>['status']
  liveness: string
  reason: string | null
}>([
  { status: 'live', liveness: 'live', reason: null },
  { status: 'exited', liveness: 'exited', reason: null },
  { status: 'unverifiable', liveness: 'unverifiable', reason: 'unverifiable' },
  { status: 'missing', liveness: 'unverifiable', reason: 'missing' },
  { status: 'identity_changed', liveness: 'unverifiable', reason: 'identity_changed' },
  { status: 'unattached', liveness: 'unverifiable', reason: 'unattached' }
])(
  'folds execution-host $status without changing the worker stage',
  async ({ status, liveness, reason }) => {
    const binding = { ...f.store.getAttemptBinding('task', 1)!, dispatchId: 'd1' }
    const worker = fleetWorker()
    expect(worker.liveness).toMatchObject({ verdict: 'unverifiable', reason: 'missing_status' })
    const inspectTerminal = vi.fn(async () => ({ status, exact: true, terminal: null }))
    expect(await projectAttempt(f.store, binding, () => worker, inspectTerminal)).toMatchObject({
      attemptId: 'd1',
      state: 'RUNNING',
      liveness,
      livenessReason: reason,
      worktreeId: 'wt'
    })
    expect(inspectTerminal).toHaveBeenCalledExactlyOnceWith('d1')
  }
)

it('preserves the host reason even when no fleet worker is available', async () => {
  const binding = { ...f.store.getAttemptBinding('task', 1)!, dispatchId: 'd1' }
  const inspectTerminal = vi
    .fn<(dispatchId: string) => ReturnType<typeof inspectWorkerTerminal>>()
    .mockResolvedValue({
      status: 'unverifiable',
      reason: 'missing_liveness_verdict',
      exact: true,
      terminal: null
    })
  expect(await projectAttempt(f.store, binding, () => null, inspectTerminal)).toMatchObject({
    state: 'START_UNKNOWN',
    liveness: 'unverifiable',
    livenessReason: 'missing_liveness_verdict',
    workspace: null,
    worktreeId: null
  })
})

it('continues to fold fleet resource release state independently of host liveness', async () => {
  const binding = { ...f.store.getAttemptBinding('task', 1)!, dispatchId: 'd1' }
  const worker = fleetWorker()
  const projectWorker = vi.fn(() => worker)
  const inspectTerminal = vi
    .fn<(dispatchId: string) => ReturnType<typeof inspectWorkerTerminal>>()
    .mockResolvedValue({
      status: 'live',
      exact: true,
      terminal: null
    })
  expect((await projectAttempt(f.store, binding, projectWorker, inspectTerminal)).workspace).toBe(
    null
  )
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
    expect(await projectAttempt(f.store, binding, projectWorker, inspectTerminal)).toMatchObject({
      state: 'RUNNING',
      liveness: 'live',
      workspace: ['retained', 'released'].includes(releaseState) ? releaseState : 'pending',
      worktreeId: 'wt'
    })
  }
})
