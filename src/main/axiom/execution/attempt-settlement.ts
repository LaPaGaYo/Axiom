import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { HeadlessOutcome } from '../../../shared/axiom-contract/submission-params'

type SettlementContext = { store: AxiomStore; missions: MissionController }
type AttemptSettlement = {
  taskId: string
  seq: number
  dispatchId: string | null
  actor: string
}

export function currentUnsubmittedTask(store: AxiomStore, input: AttemptSettlement) {
  const task = store.getTaskStage(input.taskId)
  const binding = store.getAttemptBinding(input.taskId, input.seq)
  // An old callback or recovery snapshot cannot settle a newer admission.
  return task?.stage === 'RUNNING' &&
    binding?.dispatchId === input.dispatchId &&
    store.nextAttemptSeq(input.taskId) === input.seq + 1 &&
    !(input.dispatchId !== null && store.getSubmissionByDispatch(input.dispatchId))
    ? task
    : undefined
}

export function settleVerificationFailure(
  ctx: { store: AxiomStore; missions: MissionController },
  input: { taskId: string; candidateId: string; actor?: string }
): { settled: boolean } {
  return ctx.store.transaction('settle_verification_failure', () => {
    const task = ctx.store.getTaskStage(input.taskId)
    const candidate = ctx.store.getCandidate(input.candidateId)
    if (
      task?.stage !== 'VERIFYING' ||
      candidate?.status !== 'ACTIVE' ||
      candidate.taskId !== task.taskId ||
      candidate.missionId !== task.missionId
    ) {
      return { settled: false }
    }
    ctx.missions.transitionTaskStage({
      taskId: task.taskId,
      to: 'NEEDS_FIX',
      actor: input.actor ?? 'VerificationService',
      reason: 'verification_failed'
    })
    const retry = task.attemptCount < task.retryPolicy.maxAttempts
    ctx.missions.transitionTaskStage({
      taskId: task.taskId,
      to: retry ? 'READY' : 'BLOCKED',
      actor: input.actor ?? 'VerificationService',
      reason: retry ? 'retry' : 'retry_budget_exhausted'
    })
    return { settled: true }
  })
}

export function settleAttemptWithoutSubmission(
  ctx: { store: AxiomStore; missions: MissionController },
  input: AttemptSettlement & { reason: string; blockReason?: string }
): { settled: boolean } {
  return ctx.store.transaction('settle_attempt_without_submission', () => {
    const task = currentUnsubmittedTask(ctx.store, input)
    if (!task) {
      return { settled: false }
    }
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: 'NEEDS_FIX',
      reason: input.reason,
      actor: input.actor
    })
    const retry =
      input.blockReason === undefined && task.attemptCount < task.retryPolicy.maxAttempts
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: retry ? 'READY' : 'BLOCKED',
      reason: retry ? 'retry' : (input.blockReason ?? 'retry_budget_exhausted'),
      actor: input.actor
    })
    return { settled: true }
  })
}

export function settleDeclaredAttempt(
  ctx: SettlementContext,
  input: AttemptSettlement & { outcome: Exclude<HeadlessOutcome, { outcome: 'submitted' }> }
): { settled: boolean } {
  return ctx.store.transaction('settle_declared_attempt', () => {
    if (!currentUnsubmittedTask(ctx.store, input)) {
      return { settled: false }
    }
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: 'NEEDS_FIX',
      reason: input.outcome.outcome === 'blocked' ? 'attempt_blocked' : 'attempt_no_change',
      actor: input.actor
    })
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: 'BLOCKED',
      reason: input.outcome.reason === 'blocked_by_scope' ? 'scope' : 'candidate_disputed',
      actor: input.actor
    })
    return { settled: true }
  })
}
