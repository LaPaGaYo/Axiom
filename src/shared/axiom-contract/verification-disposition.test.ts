import { expect, it } from 'vitest'
import {
  allowedVerificationDispositions,
  VerificationDispositionSchema
} from './verification-disposition'

it('lists the dispositions a verdict and a reason allow', () => {
  const flaggedReasons = [
    'test_tampering',
    'dangerous_change',
    'diff_too_large',
    'environment',
    'plan_invalid',
    'policy_invalid',
    'flaky',
    'known_flaky',
    undefined,
    'future_reason'
  ]
  const requestedReasons = ['acceptance_human', 'non_code']
  for (const reason of [...flaggedReasons, ...requestedReasons]) {
    expect(allowedVerificationDispositions('FAIL', reason)).toEqual(['fixed'])
  }
  for (const reason of flaggedReasons) {
    expect(allowedVerificationDispositions('PASS', reason)).toEqual([
      'rejected',
      'intentional',
      'not_worth'
    ])
  }
  for (const reason of requestedReasons) {
    expect(allowedVerificationDispositions('PASS', reason)).toEqual([])
  }
  expect(VerificationDispositionSchema.options).toEqual([
    'fixed',
    'rejected',
    'intentional',
    'not_worth'
  ])
  expect(VerificationDispositionSchema.safeParse('future_disposition').success).toBe(false)
})
