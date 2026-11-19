import {
  MISSION_FINALIZATION_EVENT,
  MissionFinalizationSchema,
  type MissionFinalization
} from '../../../shared/axiom-contract/mission-finalization'
import type { AxiomStore } from '../db/axiom-store'
import { utcTimestamp } from './waiting-context'

export function finalizationEntry(store: AxiomStore, missionId: string) {
  return store.getLatestReadModelAudit({
    missionId,
    objectKind: 'mission',
    objectId: missionId,
    events: ['mission.status'],
    status: 'FINALIZING'
  })?.sequence
}

export function missionFinalization(
  store: AxiomStore,
  missionId: string
): MissionFinalization | undefined {
  const entry = finalizationEntry(store, missionId)
  const event = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'mission',
    objectId: missionId,
    events: [MISSION_FINALIZATION_EVENT]
  })
  if (
    entry === undefined ||
    !event ||
    event.sequence <= entry ||
    !event.after ||
    typeof event.after !== 'object' ||
    Array.isArray(event.after)
  ) {
    return undefined
  }
  return MissionFinalizationSchema.parse({ ...event.after, at: utcTimestamp(event.createdAt) })
}

export function finalizationSummary(
  record: Extract<MissionFinalization, { outcome: 'stopped' }>
): string {
  switch (record.reason) {
    case 'target_branch_moved':
      return `Target branch ${record.targetBranch} at ${record.targetHead?.slice(0, 7)} is not contained in integration ${record.integrationHead?.slice(0, 7)}.`
    case 'target_branch_not_found':
      return `Local target branch ${record.targetBranch} was not found. Restore the branch to retry finalization.`
    case 'integration_head_unexpected':
      return `Integration head ${record.integrationHead?.slice(0, 7)} differs from its recorded head. Inspect the integration branch and its audit history.`
    case 'completion_gate_failed':
      return `Completion gate failed: ${record.gate
        ?.filter((item) => !item.pass)
        .map((item) => item.id)
        .join(', ')}. Resolve the recorded causes to retry finalization.`
    case 'finalization_unavailable':
      return `Finalization could not read the repository after three tries. Check local repository access to ${record.targetBranch}.`
  }
}
