import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import { settleVerificationFailure } from '../execution/attempt-settlement'
import type { VerificationDependencies } from './verification-service'
import type { VerificationVerdict } from './verification-verdict'
import type { VerificationCheck } from './verification-plan-runner'
import type { DiffGate } from './diff-gate'
import { auditVerification } from './verification-claim'

export class VerificationInterrupted extends Error {}

function gateAuditFindings(
  verdict: VerificationVerdict,
  gate?: DiffGate
): Record<string, string[] | DiffGate['secrets']> {
  if (!gate || gate.outcome === 'clear' || gate.reason !== verdict.reason) {
    return {}
  }
  if (gate.reason === 'scope_violation') {
    return { scopeViolations: gate.scopeViolations.slice(0, 50) }
  }
  if (gate.reason === 'secret_detected') {
    return { secrets: gate.secrets.slice(0, 50) }
  }
  if (gate.reason === 'dangerous_change') {
    return { dangerous: gate.dangerous.slice(0, 50) }
  }
  return {}
}

export function settleVerificationVerdict(
  deps: VerificationDependencies,
  input: {
    run: VerificationRun
    verdict: VerificationVerdict
    result: { checks: VerificationCheck[]; toolVersions: Record<string, string> }
    verdictDetail: VerificationRun['verdictDetail']
    finishedAt: string
    commands: string[]
    gate?: DiffGate
  }
) {
  const { store, missions, runtimeEpoch } = deps
  const { run, verdict, result, verdictDetail, finishedAt, commands, gate } = input
  const fence = {
    id: run.id,
    expectedStatus: 'RUNNING' as const,
    expectedRuntimeEpoch: runtimeEpoch,
    expectedClaimCount: run.claimCount
  }
  return store.transaction('verification_verdict', () => {
    const candidate = store.getCandidate(run.candidateId)
    if (
      store.getTaskStage(run.taskId)?.stage !== 'VERIFYING' ||
      candidate?.status !== 'ACTIVE' ||
      candidate.taskId !== run.taskId ||
      candidate.missionId !== run.missionId
    ) {
      return
    }
    if (
      !store.updateVerificationRun({
        ...fence,
        status: verdict.verdict,
        finishedAt,
        commands,
        toolVersions: result.toolVersions,
        verdictDetail
      })
    ) {
      return
    }
    if (verdict.verdict === 'PASS') {
      missions.transitionTaskStage({
        taskId: run.taskId,
        to: 'VERIFIED',
        actor: 'VerificationService',
        reason: 'verification_passed'
      })
    } else if (verdict.verdict === 'FAIL' && !settleVerificationFailure(deps, run).settled) {
      throw new VerificationInterrupted()
    }
    for (const check of result.checks.filter((check) => check.reason === 'known_flaky')) {
      auditVerification(deps, run, 'verification.known_flaky', {
        checkIndex: check.index,
        failures: check.failures
      })
    }
    auditVerification(
      deps,
      run,
      verdict.verdict === 'PASS'
        ? 'verification.passed'
        : verdict.verdict === 'FAIL'
          ? 'verification.failed'
          : 'verification.inconclusive',
      {
        ...verdict,
        ...gateAuditFindings(verdict, gate),
        ...(verdict.verdict === 'FAIL'
          ? {
              failures: result.checks.filter((c) => c.result === 'fail').flatMap((c) => c.failures)
            }
          : {})
      }
    )
    return true
  })
}
