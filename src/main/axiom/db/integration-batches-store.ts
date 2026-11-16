import { z } from 'zod'
import {
  IntegrationBatchSchema,
  IntegrationBatchStatusSchema,
  TERMINAL_INTEGRATION_BATCH_STATUSES,
  isLegalIntegrationBatchTransition
} from '../../../shared/axiom-contract/integration-batch'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { readJson, readRow, readRows } from './row-codec'

const Row = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  base_commit: GitObjectIdSchema,
  candidate_ids: z.string(),
  status: IntegrationBatchStatusSchema,
  merge_commit: GitObjectIdSchema.nullable(),
  conflicts: z.string(),
  approval_id: AxiomIdSchema.nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
})
const RowCodec = z.unknown().transform((value) => {
  const decoded = Row.safeParse(value)
  if (!decoded.success) {
    // Stored cells may contain sensitive data; never forward validation inputs.
    throw new Error('Invalid stored row in integration_batches')
  }
  const r = decoded.data
  return IntegrationBatchSchema.parse({
    id: r.id,
    missionId: r.mission_id,
    baseCommit: r.base_commit,
    candidateIds: readJson(
      IntegrationBatchSchema.shape.candidateIds,
      r.candidate_ids,
      'integration_batches',
      r.id,
      'candidate_ids'
    ),
    status: r.status,
    mergeCommit: r.merge_commit,
    conflicts: readJson(
      IntegrationBatchSchema.shape.conflicts,
      r.conflicts,
      'integration_batches',
      r.id,
      'conflicts'
    ),
    approvalId: r.approval_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })
})
const columns = Object.keys(Row.shape).join(', ')
const Insert = IntegrationBatchSchema.pick({
  id: true,
  missionId: true,
  baseCommit: true,
  candidateIds: true,
  status: true
}).extend({ status: z.enum(['QUEUED', 'APPLYING']) })
const List = z.strictObject({
  missionId: AxiomIdSchema,
  status: IntegrationBatchStatusSchema.optional(),
  candidateId: AxiomIdSchema.optional()
})
const Move = z.strictObject({ id: AxiomIdSchema, expectedStatus: IntegrationBatchStatusSchema })
const Transition = z.discriminatedUnion('status', [
  Move.extend({ status: z.literal('TESTING'), mergeCommit: GitObjectIdSchema }),
  Move.extend({
    status: z.literal('CONFLICT'),
    conflicts: IntegrationBatchSchema.shape.conflicts.min(1)
  }),
  Move.extend({ status: z.literal('APPLYING'), baseCommit: GitObjectIdSchema.optional() }),
  Move.extend({ status: z.literal('AWAITING_APPROVAL'), approvalId: AxiomIdSchema }),
  Move.extend({
    status: z.enum(['QUEUED', 'PROMOTABLE', 'PROMOTED', 'FAILED', 'REJECTED', 'SUPERSEDED'])
  })
])

export function integrationBatchesStore(db: OrchestrationDb) {
  return {
    insertIntegrationBatch(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      db.db
        .prepare(`INSERT INTO integration_batches
        (id, mission_id, base_commit, candidate_ids, status, merge_commit, conflicts, approval_id)
        VALUES (?, ?, ?, ?, ?, NULL, '[]', NULL)`)
        .run(p.id, p.missionId, p.baseCommit, JSON.stringify(p.candidateIds), p.status)
      return RowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM integration_batches WHERE id = ?`).get(p.id)
      )
    },
    getIntegrationBatch(id: string) {
      return readRow(
        RowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM integration_batches WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    listIntegrationBatches(input: z.input<typeof List>) {
      const p = List.parse(input)
      return readRows(
        RowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM integration_batches
        WHERE mission_id = ? AND (? IS NULL OR status = ?)
        AND (? IS NULL OR EXISTS (SELECT 1 FROM json_each(integration_batches.candidate_ids) WHERE value = ?))
        ORDER BY created_at, rowid`)
          .all(
            p.missionId,
            p.status ?? null,
            p.status ?? null,
            p.candidateId ?? null,
            p.candidateId ?? null
          )
      )
    },
    listOpenIntegrationBatches(missionId: string) {
      return readRows(
        RowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM integration_batches
        WHERE mission_id = ? AND status NOT IN (SELECT value FROM json_each(?))
        ORDER BY created_at, rowid`)
          .all(
            AxiomIdSchema.parse(missionId),
            JSON.stringify([...TERMINAL_INTEGRATION_BATCH_STATUSES])
          )
      )
    },
    transitionIntegrationBatch(input: z.input<typeof Transition>) {
      const p = Transition.parse(input)
      if (!isLegalIntegrationBatchTransition(p.expectedStatus, p.status)) {
        return false
      }
      const fields: Record<string, string | null> = { status: p.status }
      switch (p.status) {
        case 'TESTING':
          fields.merge_commit = p.mergeCommit
          break
        case 'CONFLICT':
          fields.conflicts = JSON.stringify(p.conflicts)
          break
        case 'APPLYING':
          if (p.baseCommit !== undefined) {
            fields.base_commit = p.baseCommit
          }
          break
        case 'AWAITING_APPROVAL':
          fields.approval_id = p.approvalId
          break
        case 'QUEUED':
          fields.merge_commit = null
          fields.conflicts = '[]'
          break
        case 'PROMOTABLE':
        case 'PROMOTED':
        case 'FAILED':
        case 'REJECTED':
        case 'SUPERSEDED':
          break
      }
      const entries = Object.entries(fields)
      return (
        db.db
          .prepare(`UPDATE integration_batches
        SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = datetime('now')
        WHERE id = ? AND status = ?`)
          .run(...entries.map(([, value]) => value), p.id, p.expectedStatus).changes === 1
      )
    }
  }
}
