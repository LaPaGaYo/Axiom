import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'

export function auditIntegration(
  store: AxiomStore,
  batch: Pick<IntegrationBatch, 'id' | 'missionId'>,
  event: string,
  after: Record<string, string | number | boolean>
): void {
  store.appendAuditEvent({
    missionId: batch.missionId,
    actor: 'IntegrationController',
    objectKind: 'integration_batch',
    objectId: batch.id,
    event,
    before: null,
    after
  })
}

/** Called inside the batch settlement transaction, including candidate and both Task moves. */
export function settleIntegrationConflict(
  ctx: { store: AxiomStore; missions: MissionController },
  input: { taskId: string; candidateId: string }
): void {
  const { store, missions } = ctx
  const task = store.getTaskStage(input.taskId)
  const candidate = store.getCandidate(input.candidateId)
  if (
    task?.stage !== 'INTEGRATION_READY' ||
    candidate?.status !== 'ACTIVE' ||
    candidate.taskId !== task.taskId ||
    candidate.missionId !== task.missionId ||
    !store.supersedeActiveCandidate(candidate.id)
  ) {
    throw new Error('integration_batch_stale')
  }
  store.appendAuditEvent({
    missionId: task.missionId,
    actor: 'IntegrationController',
    objectKind: 'candidate',
    objectId: candidate.id,
    event: 'candidate.superseded',
    before: { status: 'ACTIVE' },
    after: { status: 'SUPERSEDED', supersededBy: null, reason: 'integration_conflict' }
  })
  missions.transitionTaskStage({
    taskId: task.taskId,
    to: 'NEEDS_FIX',
    actor: 'IntegrationController',
    reason: 'integration_conflict'
  })
  const retry = task.attemptCount < task.retryPolicy.maxAttempts
  missions.transitionTaskStage({
    taskId: task.taskId,
    to: retry ? 'READY' : 'BLOCKED',
    actor: 'IntegrationController',
    reason: retry ? 'retry' : 'retry_budget_exhausted'
  })
}
