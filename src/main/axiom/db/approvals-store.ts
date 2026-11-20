import { z } from 'zod'
import {
  ApprovalSchema,
  ApprovalStatusSchema,
  ApprovalActionKindSchema,
  isLegalApprovalTransition
} from '../../../shared/axiom-contract/approval'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { readRow, readRows } from './row-codec'

const Row = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  action_kind: ApprovalActionKindSchema,
  inputs_hash: z.string().min(1),
  risk: z.string().min(1),
  status: ApprovalStatusSchema,
  expires_at: z.string().min(1),
  requested_by: z.string().min(1),
  resolver: z.string().nullable(),
  resolution: z.string().nullable(),
  outcome: z.string().nullable(),
  executed_at: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
})
const RowCodec = z.unknown().transform((value) => {
  const decoded = Row.safeParse(value)
  if (!decoded.success) {
    // Stored cells may contain sensitive data; never forward validation inputs.
    throw new Error('Invalid stored row in approvals')
  }
  const r = decoded.data
  return ApprovalSchema.parse({
    id: r.id,
    missionId: r.mission_id,
    actionKind: r.action_kind,
    inputsHash: r.inputs_hash,
    risk: r.risk,
    status: r.status,
    expiresAt: r.expires_at,
    requestedBy: r.requested_by,
    resolver: r.resolver,
    resolution: r.resolution,
    ...(r.outcome === null ? {} : { outcome: r.outcome }),
    ...(r.executed_at === null ? {} : { executedAt: r.executed_at }),
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })
})
const columns = Object.keys(Row.shape).join(', ')
const Insert = ApprovalSchema.pick({
  id: true,
  missionId: true,
  actionKind: true,
  inputsHash: true,
  risk: true,
  expiresAt: true,
  requestedBy: true
})
const List = z.strictObject({
  missionId: AxiomIdSchema,
  actionKind: ApprovalActionKindSchema.optional(),
  status: ApprovalStatusSchema.optional()
})
const Transition = z.strictObject({
  id: AxiomIdSchema,
  expectedStatus: ApprovalStatusSchema,
  status: ApprovalStatusSchema,
  resolver: ApprovalSchema.shape.resolver.optional(),
  resolution: ApprovalSchema.shape.resolution.optional()
})
const Expiry = ApprovalSchema.pick({ id: true, expiresAt: true })
const Consumption = ApprovalSchema.pick({ id: true, outcome: true, executedAt: true }).required()

export function approvalsStore(db: OrchestrationDb) {
  return {
    consumeApproval(input: z.input<typeof Consumption>) {
      const p = Consumption.parse(input)
      return (
        db.db
          .prepare(`UPDATE approvals
        SET status = 'CONSUMED', outcome = ?, executed_at = ?, updated_at = ?
        WHERE id = ? AND status = 'GRANTED'`)
          .run(p.outcome, p.executedAt, p.executedAt, p.id).changes === 1
      )
    },
    updateApprovalExpiry(input: z.input<typeof Expiry>) {
      const p = Expiry.parse(input)
      return (
        db.db
          .prepare(`UPDATE approvals SET expires_at = ?, updated_at = datetime('now')
        WHERE id = ? AND status IN ('PENDING', 'GRANTED')`)
          .run(p.expiresAt, p.id).changes === 1
      )
    },
    insertApproval(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      db.db
        .prepare(`INSERT INTO approvals
        (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by, resolver, resolution)
        VALUES (?, ?, ?, ?, ?, 'PENDING', ?, ?, NULL, NULL)`)
        .run(p.id, p.missionId, p.actionKind, p.inputsHash, p.risk, p.expiresAt, p.requestedBy)
      return RowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM approvals WHERE id = ?`).get(p.id)
      )
    },
    getApproval(id: string) {
      return readRow(
        RowCodec,
        db.db.prepare(`SELECT ${columns} FROM approvals WHERE id = ?`).get(AxiomIdSchema.parse(id))
      )
    },
    listApprovals(input: z.input<typeof List>) {
      const p = List.parse(input)
      return readRows(
        RowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM approvals
        WHERE mission_id = ? AND (? IS NULL OR action_kind = ?)
        AND (? IS NULL OR status = ?) ORDER BY created_at, rowid`)
          .all(
            p.missionId,
            p.actionKind ?? null,
            p.actionKind ?? null,
            p.status ?? null,
            p.status ?? null
          )
      )
    },
    transitionApproval(input: z.input<typeof Transition>) {
      const p = Transition.parse(input)
      if (!isLegalApprovalTransition(p.expectedStatus, p.status)) {
        return false
      }
      const fields: Record<string, string | null> = { status: p.status }
      if (p.resolver !== undefined) {
        fields.resolver = p.resolver
      }
      if (p.resolution !== undefined) {
        fields.resolution = p.resolution
      }
      const entries = Object.entries(fields)
      return (
        db.db
          .prepare(`UPDATE approvals
        SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = datetime('now')
        WHERE id = ? AND status = ?`)
          .run(...entries.map(([, value]) => value), p.id, p.expectedStatus).changes === 1
      )
    }
  }
}
