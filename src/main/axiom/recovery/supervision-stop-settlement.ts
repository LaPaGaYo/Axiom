import {
  currentUnsubmittedTask,
  settleAttemptWithoutSubmission
} from '../execution/attempt-settlement'
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
      rule: 'budget_exhausted'
      mode: 'auto'
      thresholdTokens: number
      usedTokens: number
      thresholdSource: 'task'
    }
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
    if (
      facts.rule === 'budget_exhausted' &&
      !currentUnsubmittedTask(ctx.store, { ...binding, actor: 'RecoveryService' })
    ) {
      return
    }
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
        ...(facts.rule === 'budget_exhausted' ? { blockReason: 'token_budget_exhausted' } : {}),
        actor: 'RecoveryService'
      })
    } else if (state === 'stop_unknown') {
      auditAttempt(ctx, binding, 'attempt.stop_unknown', { reason: facts.rule })
    }
  })
}
