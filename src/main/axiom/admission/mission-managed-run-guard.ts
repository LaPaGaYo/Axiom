import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { getAxiomControlPlane } from '../control-plane'

type ManagedObject = {
  runId?: string
  taskId?: string
  dispatchId?: string
  verb: string
  /** In-process authority only; never populate from RPC params or an envelope. */
  caller?: 'control_plane' | 'rpc'
}

/** §4b taskUpdate, workerStart/dispatch, gateCreate/gateResolve and runUse rows. */
export function assertNotMissionManaged(runtime: OrcaRuntimeService, input: ManagedObject): void {
  if (input.caller === 'control_plane') {
    return
  }
  const db = runtime.getOrchestrationDb()
  const dispatch = input.dispatchId ? db.getDispatchContextById(input.dispatchId) : undefined
  const taskId = input.taskId ?? dispatch?.task_id
  const runId = input.runId ?? dispatch?.run_id ?? (taskId ? db.getTask(taskId)?.run_id : undefined)
  const mission = runId ? getAxiomControlPlane(runtime).store.getMissionByRunId(runId) : undefined
  if (mission) {
    throw new OrchestrationError(
      'mission_managed',
      `${input.verb} refused: Mission ${mission.id} owns this Run and only the Control Plane may mutate it. No effects were applied.`,
      {
        missionId: mission.id,
        runId: mission.runId,
        ...(taskId ? { taskId } : {}),
        ...(input.dispatchId ? { dispatchId: input.dispatchId } : {}),
        verb: input.verb
      }
    )
  }
}

/** §4b send row (§3c): block authority-bearing mail before worker_done settlement. */
export function assertWorkerMessageAllowed(
  runtime: OrcaRuntimeService,
  input: { runId: string | undefined; type: string | undefined }
): void {
  if (
    input.type &&
    ['worker_done', 'merge_ready', 'dispatch', 'decision_gate'].includes(input.type)
  ) {
    assertNotMissionManaged(runtime, { runId: input.runId, verb: 'orchestration.send' })
  }
}

/** §4b reset row: all three global scopes can destroy Control Plane state. */
export function assertResetAllowed(
  runtime: OrcaRuntimeService,
  scope: { all?: boolean; tasks?: boolean; messages?: boolean }
): void {
  if (!scope.all && !scope.tasks && !scope.messages) {
    return
  }
  const mission = getAxiomControlPlane(runtime).store.listMissions({ limit: 1 })[0]
  if (mission) {
    throw new OrchestrationError(
      'mission_managed',
      'orchestration.reset refused: Missions own Tasks and mail in this database. Use axiom mission cancel and the Control Plane Approval path (M4). No effects were applied.',
      { missionId: mission.id, runId: mission.runId, verb: 'orchestration.reset' }
    )
  }
}

/** §4b taskCreate row: deps bypass the DAG; even deps=[] must be created by plan approval. */
export function assertTaskCreateAllowed(
  runtime: OrcaRuntimeService,
  input: { runId: string; deps: readonly string[] | undefined }
): void {
  const mission = getAxiomControlPlane(runtime).store.getMissionByRunId(input.runId)
  if (mission) {
    const reason = input.deps?.length
      ? 'Orca deps would bypass the Mission Task DAG'
      : 'only axiom.plan.approve may create Mission Tasks with authoritative stages'
    throw new OrchestrationError(
      'mission_managed',
      `orchestration.taskCreate refused: ${reason}. No effects were applied.`,
      { missionId: mission.id, runId: mission.runId, verb: 'orchestration.taskCreate' }
    )
  }
}
