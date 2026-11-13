import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'
import { superviseStall } from './attempt-stall-supervision'
import { stopSupervisedAttempt, type SupervisionStopInput } from './attempt-supervision-stop'
import { meterAttemptTokenUsage } from './attempt-token-measurement'
import { recoveryEndingStillCurrent } from './attempt-recovery-preservation'

type SupervisionInput = SupervisionStopInput & {
  startedAt: number
  minutes: number | undefined
  maxTokens: number | undefined
  thresholdSource: 'task' | 'policy'
}

export async function superviseAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  entry: AttemptReconcileEntry,
  input: SupervisionInput
): Promise<AttemptReconcileEntry> {
  const stalled = input.headless ? superviseStall(ctx, binding, input.startedAt) : undefined
  if (stalled) {
    return stopSupervisedAttempt(ctx, binding, entry, input, stalled)
  }
  const elapsedMs = ctx.now() - input.startedAt
  if (input.minutes !== undefined && elapsedMs > input.minutes * 60_000) {
    return stopSupervisedAttempt(ctx, binding, entry, input, {
      rule: 'timeout',
      mode: 'auto',
      thresholdMs: input.minutes * 60_000,
      thresholdSource: input.thresholdSource,
      elapsedMs
    })
  }
  if (input.headless && input.maxTokens !== undefined) {
    const worker = binding.dispatchId ? ctx.db.getWorkerDispatch(binding.dispatchId) : undefined
    if (
      (await meterAttemptTokenUsage(ctx, binding, true)) &&
      recoveryEndingStillCurrent(ctx, binding, worker)
    ) {
      const usedTokens = ctx.store.sumAttemptTokenUsage({ taskId: binding.taskId })
      if (usedTokens >= input.maxTokens) {
        return stopSupervisedAttempt(ctx, binding, entry, input, {
          rule: 'budget_exhausted',
          mode: 'auto',
          thresholdTokens: input.maxTokens,
          usedTokens,
          thresholdSource: 'task'
        })
      }
    }
  }
  return entry
}
