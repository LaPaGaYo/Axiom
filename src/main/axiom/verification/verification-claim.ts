import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { VerificationDependencies } from './verification-service'

export function auditVerification(
  deps: Pick<VerificationDependencies, 'store'>,
  run: VerificationRun,
  event: string,
  after: AuditEvent['after']
): void {
  deps.store.appendAuditEvent({
    missionId: run.missionId,
    actor: 'VerificationService',
    objectKind: 'verification_run',
    objectId: run.id,
    event,
    before: { status: run.status },
    after
  })
}

export function claimVerification(
  { store, missions, runtimeEpoch }: VerificationDependencies,
  missionId?: string
) {
  return store.transaction('verification_claim', () => {
    const queued = missionId
      ? store.listVerificationRuns({ missionId, status: 'QUEUED' })
      : store.listVerificationRunsByStatus('QUEUED')
    for (const run of queued) {
      const candidate = store.getCandidate(run.candidateId)
      if (!candidate) {
        throw new OrchestrationError('not_found', 'Verification Candidate is missing.')
      }
      const task = store.getTaskStage(run.taskId)
      // A restart does not move a Task backwards. Only that durable requeue may resume VERIFYING.
      const resuming =
        task?.stage === 'VERIFYING' &&
        run.verdictDetail.phase === 'requeued' &&
        run.verdictDetail.reason === 'restart' &&
        run.claimCount > 0
      const reason =
        candidate.status === 'SUPERSEDED'
          ? 'candidate_superseded'
          : task?.stage !== 'SUBMITTED' && !resuming
            ? 'task_stage_changed'
            : undefined
      if (reason) {
        if (
          store.updateVerificationRun({
            id: run.id,
            expectedStatus: 'QUEUED',
            status: 'CANCELED',
            verdictDetail: { phase: 'canceled', reason },
            finishedAt: new Date().toISOString()
          })
        ) {
          auditVerification({ store }, run, 'verification.canceled', {
            status: 'CANCELED',
            taskId: run.taskId,
            candidateId: run.candidateId,
            reason
          })
        }
        continue
      }
      const claimed = store.claimVerificationRun({
        id: run.id,
        runtimeEpoch,
        startedAt: new Date().toISOString()
      })
      if (!claimed) {
        return undefined
      }
      if (!resuming) {
        missions.transitionTaskStage({
          taskId: run.taskId,
          to: 'VERIFYING',
          actor: 'VerificationService',
          reason: 'claimed'
        })
      }
      auditVerification({ store }, run, 'verification.claimed', {
        status: 'RUNNING',
        taskId: run.taskId,
        candidateId: run.candidateId,
        claim: claimed.claimCount
      })
      return claimed
    }
    return undefined
  })
}
