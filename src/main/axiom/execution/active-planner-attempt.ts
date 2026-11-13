import type { AxiomStore } from '../db/axiom-store'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'

const activeStates = new Set(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'])

// Shared with Planner preflight: an unbound launch is active until its failure is recorded.
export function hasActivePlannerAttempt(
  store: AxiomStore,
  db: OrchestrationDb,
  missionId: string,
  bindings = store.listPlannerBindings(missionId)
): boolean {
  return bindings.some((binding) =>
    binding.dispatchId
      ? db.getDispatchContextById(binding.dispatchId)?.status === 'dispatched' ||
        activeStates.has(db.getWorkerDispatch(binding.dispatchId)?.state ?? '')
      : !store.getLatestReadModelAudit({
          missionId,
          objectId: `${binding.taskId}/${binding.seq}`,
          events: ['planner.launch_failed', 'planner.attempt_failed']
        })
  )
}
