import type { z } from 'zod'
import { VerificationResolveParams } from '../../../shared/axiom-contract/verification-params'
import { VerificationAcceptanceSchema } from '../../../shared/axiom-contract/verification-acceptance'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { MissionControllerError } from '../mission-controller/controller-context'
import { redactContext } from '../context-builder/redaction'
import { settleVerificationFailure } from '../execution/attempt-settlement'
import { auditVerification } from './verification-claim'
import type { VerificationDependencies } from './verification-service'

export function resolveVerification(
  deps: Pick<VerificationDependencies, 'store' | 'missions'>,
  input: z.input<typeof VerificationResolveParams>,
  recordMutationReceipt?: (result: unknown) => void
) {
  const p = VerificationResolveParams.parse(input)
  const { store, missions } = deps
  return store.transaction('verification_resolve', () => {
    const run = store.getVerificationRun(p.runId)
    if (!run) {
      throw new OrchestrationError('not_found', 'VerificationRun was not found.')
    }
    if (run.status !== 'HUMAN_REVIEW') {
      throw new MissionControllerError('illegal_transition', {
        runId: run.id,
        from: run.status,
        to: p.verdict,
        reason:
          run.status === 'PASS' || run.status === 'FAIL'
            ? 'deterministic_verdict_final'
            : 'run_not_pending'
      })
    }
    const task = store.getTaskStage(run.taskId)
    const candidate = store.getCandidate(run.candidateId)
    if (
      task?.stage !== 'VERIFYING' ||
      task.missionId !== run.missionId ||
      candidate?.status !== 'ACTIVE' ||
      candidate.taskId !== run.taskId ||
      candidate.missionId !== run.missionId
    ) {
      throw new MissionControllerError('stale_state', { runId: run.id, taskId: run.taskId })
    }
    if (redactContext(p.rationale).redacted) {
      throw new OrchestrationError('invalid_argument', 'secret_in_rationale')
    }
    const acceptance = VerificationAcceptanceSchema.array().safeParse(
      run.verdictDetail.acceptance ?? []
    )
    if (
      p.criteria.some(
        (index) =>
          !acceptance.success || !acceptance.data.some((criterion) => criterion.index === index)
      )
    ) {
      throw new OrchestrationError('invalid_argument', 'criterion_not_found')
    }
    if (
      !store.updateVerificationRun({
        id: run.id,
        expectedStatus: 'HUMAN_REVIEW',
        status: p.verdict,
        verdictDetail: {
          ...run.verdictDetail,
          resolution: {
            verdict: p.verdict,
            rationale: p.rationale,
            criteria: p.criteria,
            by: 'user',
            at: new Date().toISOString()
          }
        }
      })
    ) {
      throw new MissionControllerError('stale_state', { runId: run.id })
    }
    if (p.verdict === 'PASS') {
      missions.transitionTaskStage({
        taskId: run.taskId,
        to: 'VERIFIED',
        actor: 'user',
        reason: 'verification_resolved'
      })
    } else if (
      !settleVerificationFailure(deps, {
        taskId: run.taskId,
        candidateId: run.candidateId,
        actor: 'user'
      }).settled
    ) {
      throw new MissionControllerError('stale_state', { taskId: run.taskId })
    }
    auditVerification(deps, run, 'verification.resolved', {
      verdict: p.verdict,
      rationale: p.rationale,
      criteria: p.criteria,
      taskId: run.taskId,
      candidateId: run.candidateId,
      by: 'user'
    })
    const result = { runId: run.id, status: p.verdict }
    recordMutationReceipt?.(result)
    return result
  })
}
