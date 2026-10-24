import type { DiffGateOutcome } from './diff-gate'
import { expect, it } from 'vitest'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { decideVerificationVerdict, type CheckOutcome } from './verification-verdict'

it.each([
  { checks: [{ result: 'pass' }], verdict: 'PASS', reason: 'checks_passed' },
  {
    checks: [
      { result: 'fail' },
      { result: 'environmental' },
      { result: 'inconclusive', reason: 'flaky' }
    ],
    verdict: 'FAIL',
    reason: 'checks_failed'
  },
  {
    checks: [{ result: 'pass' }, { result: 'environmental' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  },
  {
    checks: [{ result: 'environmental' }, { result: 'inconclusive', reason: 'flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  },
  {
    checks: [{ result: 'pass' }, { result: 'inconclusive', reason: 'flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'flaky',
    escalation: 'specialist'
  },
  {
    checks: [{ result: 'inconclusive', reason: 'known_flaky' }],
    verdict: 'INCONCLUSIVE',
    reason: 'known_flaky',
    escalation: 'specialist'
  },
  { checks: [], verdict: 'INCONCLUSIVE', reason: 'no_checks', escalation: 'human' },
  {
    checks: [{ result: 'skipped', reason: 'time_budget_exhausted' }],
    verdict: 'INCONCLUSIVE',
    reason: 'environment',
    escalation: 'human'
  }
] satisfies {
  checks: CheckOutcome[]
  verdict: string
  reason: string
  escalation?: string
}[])('decides $reason from $checks', ({ checks, ...verdict }) => {
  expect(
    decideVerificationVerdict(checks, VerificationRulesSchema.parse({}), { outcome: 'clear' })
  ).toEqual(verdict)
})
it('uses routing for flaky and artifact-only empty plans, never for environment', () => {
  expect(
    decideVerificationVerdict(
      [],
      VerificationRulesSchema.parse({ nonCodeTasks: 'artifact_only' }),
      { outcome: 'clear' }
    )
  ).toMatchObject({ escalation: 'specialist' })
  expect(
    decideVerificationVerdict(
      [{ result: 'inconclusive', reason: 'flaky' }],
      VerificationRulesSchema.parse({ inconclusiveRouting: 'human' }),
      { outcome: 'clear' }
    )
  ).toMatchObject({ escalation: 'human' })
})

it.each([
  {
    gate: { outcome: 'fail', reason: 'secret_detected' },
    checks: [{ result: 'fail' }],
    expected: { verdict: 'FAIL', reason: 'secret_detected' }
  },
  {
    gate: { outcome: 'fail', reason: 'scope_violation' },
    checks: [],
    expected: { verdict: 'FAIL', reason: 'scope_violation' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'dangerous_change' },
    checks: [{ result: 'fail' }],
    expected: { verdict: 'FAIL', reason: 'checks_failed' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'dangerous_change' },
    checks: [{ result: 'pass' }],
    expected: { verdict: 'INCONCLUSIVE', reason: 'dangerous_change', escalation: 'human' }
  },
  {
    gate: { outcome: 'inconclusive', reason: 'diff_too_large' },
    checks: [{ result: 'environmental' }],
    expected: { verdict: 'INCONCLUSIVE', reason: 'diff_too_large', escalation: 'human' }
  },
  {
    gate: {
      outcome: 'inconclusive',
      reason: 'environment',
      detail: 'integration_base_unavailable'
    },
    checks: [{ result: 'inconclusive', reason: 'flaky' }],
    expected: {
      verdict: 'INCONCLUSIVE',
      reason: 'environment',
      detail: 'integration_base_unavailable',
      escalation: 'human'
    }
  }
] satisfies {
  gate: DiffGateOutcome
  checks: CheckOutcome[]
  expected: unknown
}[])('uses gate and command precedence %#', ({ gate, checks, expected }) => {
  expect(decideVerificationVerdict(checks, VerificationRulesSchema.parse({}), gate)).toEqual(
    expected
  )
})
