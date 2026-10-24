import type { DiffGateOutcome } from './diff-gate'
import type { VerificationRules } from '../../../shared/axiom-contract/verification-rules'

export type CheckOutcome = {
  result: 'pass' | 'fail' | 'environmental' | 'inconclusive' | 'skipped'
  reason?: string
}
export type VerificationVerdict = {
  verdict: 'PASS' | 'FAIL' | 'INCONCLUSIVE'
  reason:
    | 'scope_violation'
    | 'secret_detected'
    | 'dangerous_change'
    | 'diff_too_large'
    | 'checks_passed'
    | 'checks_failed'
    | 'environment'
    | 'flaky'
    | 'known_flaky'
    | 'no_checks'
    | 'policy_invalid'
  escalation?: 'specialist' | 'human'
  detail?: string
}

export function decideVerificationVerdict(
  checks: CheckOutcome[],
  rules: VerificationRules,
  gate: DiffGateOutcome
): VerificationVerdict {
  if (gate.outcome === 'fail') {
    return { verdict: 'FAIL', reason: gate.reason }
  }
  if (checks.some((check) => check.result === 'fail')) {
    return { verdict: 'FAIL', reason: 'checks_failed' }
  }
  if (gate.outcome === 'inconclusive') {
    return {
      verdict: 'INCONCLUSIVE',
      reason: gate.reason,
      ...(gate.detail ? { detail: gate.detail } : {}),
      escalation: 'human'
    }
  }
  if (checks.some((check) => check.result === 'environmental')) {
    return { verdict: 'INCONCLUSIVE', reason: 'environment', escalation: 'human' }
  }
  if (checks.some((check) => check.result === 'inconclusive')) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: checks.some((check) => check.reason === 'flaky') ? 'flaky' : 'known_flaky',
      escalation: rules.inconclusiveRouting
    }
  }
  if (!checks.length) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: 'no_checks',
      escalation: rules.nonCodeTasks === 'human_confirm' ? 'human' : rules.inconclusiveRouting
    }
  }
  // A deadline can expire before the first process starts. Skipped work is never a PASS.
  if (checks.some((check) => check.result === 'skipped')) {
    return { verdict: 'INCONCLUSIVE', reason: 'environment', escalation: 'human' }
  }
  return { verdict: 'PASS', reason: 'checks_passed' }
}
