import { z } from 'zod'
import { AuditEventSchema, AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AXIOM_COLUMNS, AuditRowCodec } from './axiom-rows'
import { readRow } from './row-codec'

const Latest = z.object({
  missionId: AxiomIdSchema,
  objectId: z.string().min(1).optional(),
  objectKind: AuditEventSchema.shape.objectKind.optional(),
  events: z.array(z.string().min(1)).min(1),
  stage: z.string().optional(),
  status: z.string().optional()
})

export function readModelAuditsStore(db: OrchestrationDb) {
  return {
    getLatestReadModelAudit(input: z.input<typeof Latest>) {
      const p = Latest.parse(input)
      return readRow(
        AuditRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.audit_events} FROM audit_events
          WHERE mission_id = ? AND (? IS NULL OR object_id = ?)
            AND (? IS NULL OR object_kind = ?)
            AND event IN (SELECT value FROM json_each(?))
            AND (? IS NULL OR json_extract(after, '$.stage') = ?)
            AND (? IS NULL OR json_extract(after, '$.status') = ?)
          ORDER BY sequence DESC LIMIT 1`)
          .get(
            p.missionId,
            p.objectId ?? null,
            p.objectId ?? null,
            p.objectKind ?? null,
            p.objectKind ?? null,
            JSON.stringify(p.events),
            p.stage ?? null,
            p.stage ?? null,
            p.status ?? null,
            p.status ?? null
          )
      )
    }
  }
}
