import {
  MISSION_FINALIZATION_EVENT,
  FinalizationOutcomeSchema,
  type FinalizationOutcome
} from '../../../shared/axiom-contract/mission-finalization'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { recordedIntegrationHead } from '../integration/integration-head'
import { finalizationEntry, missionFinalization } from '../read-models/finalization-reads'

export function recordFinalization(
  store: AxiomStore,
  missions: Pick<MissionController, 'readyForApproval'>,
  missionId: string,
  outcome: FinalizationOutcome,
  entry = finalizationEntry(store, missionId)
): void {
  store.transaction('finalization_recorded', () => {
    if (
      store.getMission(missionId)?.status !== 'FINALIZING' ||
      finalizationEntry(store, missionId) !== entry
    ) {
      return
    }
    if (
      outcome.outcome === 'ready' &&
      recordedIntegrationHead(store, missionId) !== outcome.integrationHead
    ) {
      outcome = {
        ...outcome,
        outcome: 'stopped',
        reason: 'integration_head_unexpected',
        gate: outcome.gate?.map((item) =>
          item.id === 'integration_head_recorded' ? { ...item, pass: false } : item
        )
      }
    }
    const after = FinalizationOutcomeSchema.parse(outcome)
    const previous = missionFinalization(store, missionId)
    const prior = previous && (({ at: _at, ...record }) => record)(previous)
    if (JSON.stringify(prior) !== JSON.stringify(after)) {
      store.appendAuditEvent({
        missionId,
        actor: 'MissionController',
        objectKind: 'mission',
        objectId: missionId,
        event: MISSION_FINALIZATION_EVENT,
        before: null,
        after
      })
    }
    if (after.outcome === 'ready') {
      missions.readyForApproval(missionId)
    }
  })
}
