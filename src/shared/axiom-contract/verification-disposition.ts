import { z } from 'zod'

export const VerificationDispositionSchema = z.enum([
  'fixed',
  'rejected',
  'intentional',
  'not_worth'
])
export type VerificationDisposition = z.infer<typeof VerificationDispositionSchema>

/** Glossary §4.8: classify the human resolution using the run's recorded reason. */
export function allowedVerificationDispositions(
  verdict: 'PASS' | 'FAIL',
  reason: unknown
): VerificationDisposition[] {
  if (verdict === 'FAIL') {
    return ['fixed']
  }
  if (reason === 'acceptance_human' || reason === 'non_code') {
    return []
  }
  return ['rejected', 'intentional', 'not_worth']
}
