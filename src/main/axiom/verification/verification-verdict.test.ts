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
  expect(decideVerificationVerdict(checks, VerificationRulesSchema.parse({}))).toEqual(verdict)
})
it('uses routing for flaky and artifact-only empty plans, never for environment', () => {
  expect(
    decideVerificationVerdict([], VerificationRulesSchema.parse({ nonCodeTasks: 'artifact_only' }))
  ).toMatchObject({ escalation: 'specialist' })
  expect(
    decideVerificationVerdict(
      [{ result: 'inconclusive', reason: 'flaky' }],
      VerificationRulesSchema.parse({ inconclusiveRouting: 'human' })
    )
  ).toMatchObject({ escalation: 'human' })
})
