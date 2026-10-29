import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { ClaudeMissionTurnSettlement } from '../../claude/claude-mission-session-pins'
import type { AxiomStore } from '../db/axiom-store'
import { stopPlanner } from './planner-stop'

export async function settleClaudePlannerTurn(
  runtime: OrcaRuntimeService,
  store: AxiomStore,
  binding: { missionId: string; dispatchId: string },
  settlement: ClaudeMissionTurnSettlement
): Promise<void> {
  const claimed = store.transaction('planner_turn_settled', () => {
    const settled = store
      .listAuditEvents({ missionId: binding.missionId })
      .some(
        (event) =>
          event.objectKind === 'attempt' &&
          event.objectId === binding.dispatchId &&
          ['planner.proposed', 'planner.attempt_failed'].includes(event.event)
      )
    if (settled) {
      return false
    }
    store.appendAuditEvent({
      missionId: binding.missionId,
      actor: 'MissionController',
      objectKind: 'attempt',
      objectId: binding.dispatchId,
      event: 'planner.attempt_failed',
      before: null,
      after: { reason: 'no_proposal', evidence: 'turn_settled', ...settlement }
    })
    return true
  })
  if (claimed) {
    await stopPlanner(runtime, store, binding, 'no_proposal')
  }
}
