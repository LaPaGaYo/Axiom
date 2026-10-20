import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'

export function settleAttemptWithoutSubmission(
  ctx: { store: AxiomStore; missions: MissionController },
  input: { taskId: string; seq: number; dispatchId: string | null; reason: string; actor: string }
): { settled: boolean } {
  return ctx.store.transaction('settle_attempt_without_submission', () => {
    const task = ctx.store.getTaskStage(input.taskId)
    const binding = ctx.store.getAttemptBinding(input.taskId, input.seq)
    // An old launch callback or recovery snapshot cannot settle a newer admission.
    if (
      task?.stage !== 'RUNNING' ||
      !binding ||
      binding.dispatchId !== input.dispatchId ||
      ctx.store.nextAttemptSeq(input.taskId) !== input.seq + 1 ||
      (input.dispatchId !== null && ctx.store.getSubmissionByDispatch(input.dispatchId))
    ) {
      return { settled: false }
    }
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: 'NEEDS_FIX',
      reason: input.reason,
      actor: input.actor
    })
    const retry = task.attemptCount < task.retryPolicy.maxAttempts
    ctx.missions.transitionTaskStage({
      taskId: input.taskId,
      to: retry ? 'READY' : 'BLOCKED',
      reason: retry ? 'retry' : 'retry_budget_exhausted',
      actor: input.actor
    })
    return { settled: true }
  })
}
