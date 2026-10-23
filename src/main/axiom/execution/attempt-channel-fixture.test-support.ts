import { vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { createInput, propose, actor } from '../mission-controller/controller-fixture.test-support'
import { provenance } from '../../../shared/axiom-contract/contract-fixtures.test-support'

export const subtask = {
  title: 'Follow-up',
  objective: 'Validate migration',
  allowedPaths: ['src/storage/'],
  acceptanceCriteria: ['Checks pass'],
  requiredEvidence: ['Test report'],
  risk: 'low' as const
}
export const workerVerbs = ['inform', 'request', 'blocked', 'handoff', 'request-subtask'] as const
export const workerTypes = ['INFORM', 'REQUEST', 'BLOCKED', 'HANDOFF', 'REQUEST_SUBTASK'] as const

export function channelFixture(dbPath = ':memory:') {
  const f = rpcFixture(dbPath)
  const { missions } = getAxiomControlPlane(f.runtime)
  const { mission, goalRevision } = missions.createMission(createInput)
  const plan = propose(missions, mission.id, goalRevision.id)
  missions.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
  const panes = new Map<string, string>()
  const processes = new Map<string, string>()
  vi.spyOn(f.runtime, 'getTerminalPaneKey').mockImplementation(
    (handle) => panes.get(handle) ?? null
  )
  vi.spyOn(f.runtime, 'getTerminalProcessIncarnation').mockImplementation(
    (handle) => processes.get(handle) ?? null
  )
  vi.spyOn(f.runtime, 'getLiveTerminalPaneKey').mockImplementation(
    (handle) => panes.get(handle) ?? null
  )
  vi.spyOn(f.runtime, 'getTerminalHandleForPaneKey').mockImplementation(
    (paneKey) => [...panes].find(([, pane]) => pane === paneKey)?.[0] ?? null
  )
  const notify = vi.spyOn(f.runtime, 'notifyMessageArrived').mockImplementation(() => {})
  function bind(
    proposalId: string,
    identity?: { from: string; paneKey: string; processIncarnation: string }
  ) {
    const task = f.store
      .listTaskStages({ missionId: mission.id })
      .find((t) => t.spec.id === proposalId)!
    const seq = f.store.nextAttemptSeq(task.taskId)
    const from = identity?.from ?? `term_${proposalId}_${seq}`
    const paneKey = identity?.paneKey ?? `pane_${proposalId}_${seq}`
    const processIncarnation = identity?.processIncarnation ?? `process_${proposalId}_${seq}`
    panes.set(from, paneKey)
    processes.set(from, processIncarnation)
    const { dispatch } = f.db.createStartingWorkerDispatch({
      taskId: task.taskId,
      creator: { kind: 'system' },
      maxDepth: 1,
      startOptions: { topology: 'current', agent: 'codex' }
    })
    f.db.prepareStartingWorkerAuthority({
      dispatchId: dispatch.id,
      handle: from,
      paneKey,
      processIncarnation,
      worktreeId: `repo::${proposalId}`,
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    f.db.markWorkerDispatchReady(dispatch.id)
    // Adversarial routing fixture: downstream Tasks already have running Attempts.
    f.store.updateTaskStage({
      taskId: task.taskId,
      from: task.stage,
      to: 'RUNNING',
      attemptCountDelta: 1
    })
    f.store.insertAttemptBinding({
      taskId: task.taskId,
      missionId: mission.id,
      seq,
      branch: `axiom/attempt/${task.taskId}/${seq}`,
      dispatchId: dispatch.id,
      agentSpecId: 'test-spec',
      contextPackageId: 'test-context'
    })
    return {
      taskId: task.taskId,
      attemptId: dispatch.id,
      from,
      paneKey,
      processIncarnation
    }
  }
  const snapshot = () =>
    ['messages', 'audit_events', 'mutation_receipts', 'task_stages'].map((table) =>
      f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    )
  const t01 = bind('T01')
  return { ...f, missions, mission, plan, bind, t01, panes, processes, notify, snapshot }
}
