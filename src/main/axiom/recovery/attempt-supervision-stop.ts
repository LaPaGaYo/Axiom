import { z } from 'zod'
import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'
import { captureRecoveryAttempt, recoveryEndingStillCurrent } from './attempt-recovery-preservation'
import { settleRecoveryBudget } from './attempt-recovery-endings'
import { settleSupervisionStop, type SupervisionStopFacts } from './supervision-stop-settlement'

const StopReceipt = z.object({ state: z.string() })
export type SupervisionStopInput = {
  headless: boolean
  stop: () => Promise<unknown>
  reconcile: () => Promise<AttemptReconcileEntry>
}

export async function stopSupervisedAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  entry: AttemptReconcileEntry,
  input: SupervisionStopInput,
  facts: SupervisionStopFacts
): Promise<AttemptReconcileEntry> {
  const stopped = StopReceipt.parse(await input.stop())
  const stoppedWorker = binding.dispatchId
    ? ctx.db.getWorkerDispatch(binding.dispatchId)
    : undefined
  const preserved =
    input.headless && stopped.state === 'stopped'
      ? await captureRecoveryAttempt(ctx, binding, 'stopped')
      : undefined
  if (
    input.headless &&
    (stoppedWorker?.state !== stopped.state ||
      !recoveryEndingStillCurrent(ctx, binding, stoppedWorker))
  ) {
    return input.reconcile()
  }
  if (facts.rule === 'timeout') {
    settleRecoveryBudget(ctx, binding, stopped.state, facts, preserved)
  } else {
    settleSupervisionStop(
      ctx,
      binding,
      stopped.state,
      facts,
      preserved,
      facts.rule === 'budget_exhausted' ? 'recovery_token_stop' : 'recovery_stall_stop'
    )
  }
  entry.action = stopped.state
  return entry
}
