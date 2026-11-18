import { isRepoOnCatalogHost } from '../../../shared/execution-host'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import type { Mission } from '../../../shared/axiom-contract/mission-objects'
import type { AxiomStore } from '../db/axiom-store'
import type { IntegrationRuntime } from './integration-scratch'

export async function integrationRepository(runtime: IntegrationRuntime, mission: Mission) {
  let repo: Awaited<ReturnType<IntegrationRuntime['showRepo']>>
  try {
    repo = await runtime.showRepo(`id:${mission.repoId}`)
  } catch {
    throw new Error('integration_head_unavailable')
  }
  if (!isRepoOnCatalogHost(repo)) {
    throw new Error('repository_not_local')
  }
  return repo.path
}

export function recordedIntegrationHead(store: AxiomStore, missionId: string) {
  // ponytail: scans all Mission events per batch start or show; use a filtered store query as Missions grow.
  const latest = store
    .listAuditEvents({ missionId })
    .findLast(
      (event) =>
        event.event === 'integration.batch_promoted' ||
        (['integration.base_created', 'integration.base_reused'].includes(event.event) &&
          event.objectKind === 'mission' &&
          event.objectId === missionId)
    )
  const after = latest?.after
  const value =
    after && typeof after === 'object' && !Array.isArray(after)
      ? after[latest.event === 'integration.batch_promoted' ? 'mergeCommit' : 'sha']
      : undefined
  const recorded = GitObjectIdSchema.safeParse(value)
  return recorded.success ? recorded.data : undefined
}

export function assertRecordedIntegrationHead(store: AxiomStore, missionId: string, head: string) {
  try {
    if (recordedIntegrationHead(store, missionId) === head) {
      return
    }
  } catch {
    // Missing or unreadable recorded authority cannot start a batch.
  }
  throw new Error('integration_head_unexpected')
}
