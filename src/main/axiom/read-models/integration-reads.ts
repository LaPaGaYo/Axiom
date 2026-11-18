import type {
  MissionIntegration,
  TaskIntegration
} from '../../../shared/axiom-contract/integration-batch'
import type { AxiomStore } from '../db/axiom-store'
import { recordedIntegrationHead } from '../integration/integration-head'
import { integrationHeadRef } from '../integration/integration-scratch'
import { utcTimestamp } from './waiting-context'

export function taskIntegrations(store: AxiomStore, missionId: string) {
  const candidates = new Map(
    store.listCandidates(missionId).map((candidate) => [candidate.id, candidate.taskId])
  )
  const integrations = new Map<string, TaskIntegration>()
  for (const batch of store.listIntegrationBatches({ missionId })) {
    const candidateId = batch.candidateIds[0]
    const taskId = candidates.get(candidateId)
    if (!taskId) {
      continue
    }
    integrations.set(taskId, {
      batchId: batch.id,
      candidateId,
      status: batch.status,
      baseCommit: batch.baseCommit,
      mergeCommit: batch.mergeCommit,
      conflicts: batch.conflicts,
      updatedAt: utcTimestamp(batch.updatedAt)
    })
  }
  return integrations
}

export function missionIntegration(
  store: AxiomStore,
  missionId: string
): MissionIntegration | undefined {
  const recordedHead = recordedIntegrationHead(store, missionId)
  return recordedHead
    ? { branch: integrationHeadRef(missionId).slice('refs/heads/'.length), recordedHead }
    : undefined
}
