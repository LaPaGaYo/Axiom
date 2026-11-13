import { z } from 'zod'
import { SupervisionEvidenceSchema } from '../../../shared/axiom-contract/supervision'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { AuditRowCodec, AuditRowSchema } from './audit-rows'
import { readRow } from './row-codec'

const Sequence = z.number().int().nonnegative()
const reconciled = `r.event = 'attempt.supervision_reconciled' AND r.object_kind = 'attempt'
  AND r.mission_id = a.mission_id AND r.object_id = a.object_id
  AND json_extract(r.after, '$.rule') = 'stalled'
  AND json_extract(r.after, '$.observationSequence') = a.sequence`

export function supervisionEvidenceStore(db: OrchestrationDb) {
  return {
    listUnreconciledStallObservations(limit: number) {
      return z
        .array(z.object({ sequence: Sequence }))
        .parse(
          db.db
            .prepare(`SELECT a.sequence
        FROM audit_events a INDEXED BY idx_audit_events_event_sequence
        WHERE a.event = 'attempt.supervised' AND a.object_kind = 'attempt'
          AND json_extract(a.after, '$.rule') = 'stalled'
          AND json_extract(a.after, '$.mode') IN ('observe', 'notify')
          AND NOT EXISTS (SELECT 1 FROM audit_events r WHERE ${reconciled})
        ORDER BY a.sequence LIMIT ?`)
            .all(z.number().int().positive().parse(limit))
        )
        .map((row) => row.sequence)
    },
    getUnreconciledStallObservation(sequence: number) {
      return readRow(
        AuditRowCodec,
        db.db
          .prepare(`SELECT ${Object.keys(AuditRowSchema.shape)
            .map((key) => `a.${key}`)
            .join(', ')}
        FROM audit_events a WHERE a.sequence = ? AND a.event = 'attempt.supervised'
          AND NOT EXISTS (SELECT 1 FROM audit_events r WHERE ${reconciled})`)
          .get(Sequence.parse(sequence))
      )
    },
    readSupervisionEvidence(sinceSequence: number) {
      const since = Sequence.parse(sinceSequence)
      const row = z
        .object({
          hits: Sequence,
          falsePositives: Sequence,
          inconclusive: Sequence,
          savedMs: z.number().nonnegative(),
          throughSequence: Sequence
        })
        .parse(
          db.db
            .prepare(`SELECT
        COALESCE(SUM(json_extract(after, '$.outcome') = 'hit'), 0) AS hits,
        COALESCE(SUM(json_extract(after, '$.outcome') = 'false_positive'), 0) AS falsePositives,
        COALESCE(SUM(json_extract(after, '$.outcome') = 'inconclusive'), 0) AS inconclusive,
        COALESCE(SUM(CASE WHEN json_extract(after, '$.outcome') = 'hit'
          THEN json_extract(after, '$.savedMs') ELSE 0 END), 0) AS savedMs,
          COALESCE(MAX(sequence), 0) AS throughSequence
        FROM audit_events INDEXED BY idx_audit_events_event_sequence
        WHERE event = 'attempt.supervision_reconciled' AND sequence > ?
          AND object_kind = 'attempt' AND json_extract(after, '$.rule') = 'stalled'
          AND json_extract(after, '$.outcome') IN ('hit', 'false_positive', 'inconclusive')`)
            .get(since)
        )
      const known = row.hits + row.falsePositives
      return SupervisionEvidenceSchema.parse({
        ...row,
        known,
        hitRate: known ? row.hits / known : null,
        sinceSequence: since
      })
    }
  }
}
