import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'
import { superviseStall } from './attempt-stall-supervision'
import { stopSupervisedAttempt, type SupervisionStopInput } from './attempt-supervision-stop'

type SupervisionInput = SupervisionStopInput & {
  startedAt: number
  minutes: number | undefined
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
  return entry
}
