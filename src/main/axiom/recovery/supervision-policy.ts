import { z } from 'zod'
import { getMainE2EConfig } from '../../e2e-config'
import type { RecoveryContext } from './attempt-recovery-effects'

export const STALL_DEFAULT_THRESHOLD_MS = 20 * 60_000
export const STALL_MIN_THRESHOLD_MS = 5 * 60_000
export const STALL_CADENCE_WINDOW = 20
export const STALL_MIN_VERIFIED_ATTEMPTS = 5
export const STALL_GAP_MULTIPLIER = 2

type StallThreshold = {
  thresholdMs: number
  thresholdSource: 'measured' | 'default' | 'e2e'
}
// Recovery creates one context per pass. No timer or durable policy is added.
const thresholds = new WeakMap<RecoveryContext, StallThreshold>()

function computeStallThreshold(ctx: RecoveryContext): StallThreshold {
  const configured = getMainE2EConfig().enabled
    ? Number(process.env.AXIOM_E2E_STALL_THRESHOLD_MS)
    : Number.NaN
  if (Number.isSafeInteger(configured) && configured > 0) {
    return { thresholdMs: configured, thresholdSource: 'e2e' }
  }
  // Qualify before LIMIT: newer partial or unverified Attempts must not hide eligible history.
  // EXISTS counts an Attempt once even when its Candidate has several passing runs.
  const cadences = z.array(z.object({ maxEventGapMs: z.number().nonnegative() })).parse(
    ctx.db.db
      .prepare(`SELECT json_extract(a.after, '$.maxEventGapMs') AS maxEventGapMs
      FROM audit_events a WHERE a.event = ? AND a.object_kind = 'attempt'
      AND json_type(a.after, '$.partial') = 'false'
      AND json_type(a.after, '$.samples') = 'integer'
      AND json_extract(a.after, '$.samples') >= 2
      AND json_type(a.after, '$.maxEventGapMs') IN ('integer', 'real')
      AND json_extract(a.after, '$.maxEventGapMs') >= 0
      AND EXISTS (
        SELECT 1 FROM submissions s JOIN candidates c ON c.id = s.candidate_id
        JOIN verification_runs v ON v.candidate_id = c.id AND v.mission_id = s.mission_id
        WHERE s.dispatch_id = a.object_id AND s.mission_id = a.mission_id AND v.status = 'PASS'
      ) ORDER BY a.sequence DESC LIMIT ?`)
      .all('attempt.cadence', STALL_CADENCE_WINDOW)
  )
  return cadences.length >= STALL_MIN_VERIFIED_ATTEMPTS
    ? {
        thresholdMs: Math.max(
          STALL_MIN_THRESHOLD_MS,
          STALL_GAP_MULTIPLIER * Math.max(...cadences.map((row) => row.maxEventGapMs))
        ),
        thresholdSource: 'measured'
      }
    : { thresholdMs: STALL_DEFAULT_THRESHOLD_MS, thresholdSource: 'default' }
}

export function stallThresholdForPass(ctx: RecoveryContext): StallThreshold {
  let threshold = thresholds.get(ctx)
  if (!threshold) {
    threshold = computeStallThreshold(ctx)
    thresholds.set(ctx, threshold)
  }
  return threshold
}
