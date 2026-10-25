import type { DiffGateOutcome } from './diff-gate'
import type { WorkerArtifactChecks } from './worker-artifacts'
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
    | 'test_tampering'
    | 'artifact_missing'
    | 'artifact_invalid'
    | 'checks_passed'
    | 'checks_failed'
    | 'environment'
    | 'flaky'
    | 'known_flaky'
    | 'non_code'
    | 'policy_invalid'
  escalation?: 'specialist' | 'human'
  detail?: string
}

export function decideVerificationVerdict(
  checks: CheckOutcome[],
  rules: VerificationRules,
  gate: DiffGateOutcome,
  nonCodeTask: boolean,
  artifacts: WorkerArtifactChecks
): VerificationVerdict {
  if (gate.outcome === 'fail') {
    return { verdict: 'FAIL', reason: gate.reason }
  }
  if (checks.some((check) => check.result === 'fail')) {
    return { verdict: 'FAIL', reason: 'checks_failed' }
  }
  if (nonCodeTask) {
    if (!artifacts.counts.checked) {
      return { verdict: 'FAIL', reason: 'artifact_missing' }
    }
    if (artifacts.counts.empty || artifacts.counts.invalid_utf8 || artifacts.counts.invalid_json) {
      return { verdict: 'FAIL', reason: 'artifact_invalid' }
    }
    if (
      artifacts.counts.unreadable &&
      !(gate.outcome === 'inconclusive' && gate.reason === 'environment')
    ) {
      return {
        verdict: 'INCONCLUSIVE',
        reason: 'environment',
        detail: 'artifact_unreadable',
        escalation: 'human'
      }
    }
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
  // A deadline can expire before the first process starts. Skipped work is never a PASS.
  if (checks.some((check) => check.result === 'skipped')) {
    return { verdict: 'INCONCLUSIVE', reason: 'environment', escalation: 'human' }
  }
  if (nonCodeTask) {
    return {
      verdict: 'INCONCLUSIVE',
      reason: 'non_code',
      escalation: rules.nonCodeTasks === 'human_confirm' ? 'human' : rules.inconclusiveRouting
    }
  }
  return { verdict: 'PASS', reason: 'checks_passed' }
}
