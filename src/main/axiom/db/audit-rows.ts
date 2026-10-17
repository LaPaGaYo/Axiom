import { z } from 'zod'
import { AuditEventSchema, AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { readJson } from './row-codec'

export const AuditRowSchema = z.object({
  sequence: AuditEventSchema.shape.sequence,
  mission_id: AxiomIdSchema,
  actor: z.string(),
  object_kind: z.string(),
  object_id: AxiomIdSchema,
  event: z.string(),
  before: z.string().nullable(),
  after: z.string().nullable(),
  created_at: z.string().min(1)
})
export const AuditRowCodec = AuditRowSchema.transform((row) =>
  AuditEventSchema.parse({
    sequence: row.sequence,
    missionId: row.mission_id,
    actor: row.actor,
    objectKind: row.object_kind,
    objectId: row.object_id,
    event: row.event,
    before:
      row.before === null
        ? null
        : readJson(
            AuditEventSchema.shape.before,
            row.before,
            'audit_events',
            row.sequence,
            'before'
          ),
    after:
      row.after === null
        ? null
        : readJson(AuditEventSchema.shape.after, row.after, 'audit_events', row.sequence, 'after'),
    createdAt: row.created_at
  })
)
