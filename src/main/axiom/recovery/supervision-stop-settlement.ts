import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import type { captureRecoveryAttempt } from './attempt-recovery-preservation'
import { auditAttempt, type AttemptBinding, type RecoveryContext } from './attempt-recovery-effects'

export type StallStopFacts = {
  rule: 'stalled'
  mode: 'stop'
  thresholdMs: number
  thresholdSource: 'measured' | 'default' | 'e2e'
  idleMs: number
  lastEventAt: string
}
export type SupervisionStopFacts =
  | StallStopFacts
  | {
      rule: 'timeout'
      mode: 'auto'
      thresholdMs: number
      thresholdSource: 'task' | 'policy'
      elapsedMs: number
    }

export function settleSupervisionStop(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  state: string,
  facts: SupervisionStopFacts,
  preserved: Awaited<ReturnType<typeof captureRecoveryAttempt>>,
  transaction: string
) {
  ctx.store.transaction(transaction, () => {
    if (state === 'stopped' || state === 'stop_unknown') {
      auditAttempt(ctx, binding, 'attempt.supervised', { ...facts, action: state })
    }
    if (state === 'stopped') {
      auditAttempt(ctx, binding, 'attempt.stopped', { reason: facts.rule })
      if (preserved) {
        auditAttempt(ctx, binding, 'attempt.preserved', preserved)
      }
      settleAttemptWithoutSubmission(ctx, {
        ...binding,
        reason: facts.rule,
        actor: 'RecoveryService'
      })
    } else if (state === 'stop_unknown') {
      auditAttempt(ctx, binding, 'attempt.stop_unknown', { reason: facts.rule })
    }
  })
}
