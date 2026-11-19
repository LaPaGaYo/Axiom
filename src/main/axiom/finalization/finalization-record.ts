import {
  MISSION_FINALIZATION_EVENT,
  FinalizationOutcomeSchema,
  type FinalizationOutcome
} from '../../../shared/axiom-contract/mission-finalization'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { recordedIntegrationHead } from '../integration/integration-head'
import { finalizationEntry, missionFinalization } from '../read-models/finalization-reads'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { sha256 } from '../artifacts/artifact-store'
import { completionReportText } from '../../../shared/axiom-contract/completion-report'
import { buildCompletionReport } from './completion-report'

export function recordFinalization(
  store: AxiomStore,
  db: OrchestrationDb,
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
        targetBranch: outcome.targetBranch,
        targetHead: outcome.targetHead,
        integrationHead: outcome.integrationHead,
        outcome: 'stopped',
        reason: 'integration_head_unexpected',
        gate: outcome.gate?.map((item) =>
          item.id === 'integration_head_recorded' ? { ...item, pass: false } : item
        )
      }
    }
    const after = FinalizationOutcomeSchema.parse(outcome)
    if (after.outcome === 'ready') {
      const artifact = after.reportArtifactId && store.getArtifact(after.reportArtifactId)
      if (
        !artifact ||
        artifact.kind !== 'completion_report' ||
        artifact.missionId !== missionId ||
        artifact.sha256 !== after.reportSha256 ||
        !after.integrationHead ||
        !after.targetHead
      ) {
        throw new Error('completion_report_missing')
      }
      const report = buildCompletionReport(store, db, missionId, {
        integrationHead: after.integrationHead,
        targetHead: after.targetHead,
        targetContained: true
      })
      if (sha256(completionReportText(report)) !== artifact.sha256) {
        throw new Error('completion_report_changed')
      }
    }
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
      missions.readyForApproval(missionId, after.reportSha256)
    }
  })
}
