import { z } from 'zod'
import { BLOCKING_APPROVAL_ACTION_KINDS } from '../../../shared/axiom-contract/lifecycle'
import {
  AuditEventSchema,
  AxiomIdSchema,
  PolicySchema,
  type Policy
} from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AXIOM_COLUMNS, AuditRowCodec, PolicyRowCodec } from './axiom-rows'
import { readRow, readRows } from './row-codec'

const AppendSchema = AuditEventSchema.omit({ sequence: true }).extend({
  createdAt: AuditEventSchema.shape.createdAt.optional()
})
const ListSchema = z.object({
  missionId: AxiomIdSchema,
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().optional()
})

export function policyAuditStore(db: OrchestrationDb) {
  return {
    hasMessageAudit(missionId: string, messageId: string): boolean {
      return (
        db.db
          .prepare(`SELECT 1 FROM audit_events WHERE mission_id = ?
        AND object_kind = 'message' AND object_id = ?
        AND event IN ('mailbox.message', 'message.received') LIMIT 1`)
          .get(AxiomIdSchema.parse(missionId), AxiomIdSchema.parse(messageId)) !== undefined
      )
    },
    upsertPolicy(missionId: string, policy: Policy): void {
      const key = AxiomIdSchema.parse(missionId)
      const p = PolicySchema.parse(policy)
      db.db
        .prepare(`INSERT INTO mission_policies
        (mission_id, concurrency_limit, budget, readiness_threshold, approval_rules, verification_rules,
         nested_worker_max_depth, unverifiable_tolerance_minutes, routing) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mission_id) DO UPDATE SET concurrency_limit = excluded.concurrency_limit,
          routing = excluded.routing, budget = excluded.budget, readiness_threshold = excluded.readiness_threshold,
          approval_rules = excluded.approval_rules, verification_rules = excluded.verification_rules,
          nested_worker_max_depth = excluded.nested_worker_max_depth,
          unverifiable_tolerance_minutes = excluded.unverifiable_tolerance_minutes,
          updated_at = datetime('now')`)
        .run(
          key,
          p.concurrencyLimit,
          JSON.stringify(p.budget),
          p.readinessThreshold,
          JSON.stringify(p.approvalRules),
          JSON.stringify(p.verificationRules),
          p.nestedWorkerMaxDepth,
          p.unverifiableToleranceMinutes,
          JSON.stringify(p.routing)
        )
    },
    hasBlockingApproval(missionId: string): boolean {
      return (
        db.db
          .prepare(`SELECT 1 FROM approvals
        WHERE mission_id = ? AND status = 'PENDING'
          AND action_kind IN (SELECT value FROM json_each(?)) LIMIT 1`)
          .get(AxiomIdSchema.parse(missionId), JSON.stringify(BLOCKING_APPROVAL_ACTION_KINDS)) !==
        undefined
      )
    },
    getPolicy(missionId: string) {
      const key = AxiomIdSchema.parse(missionId)
      return readRow(
        PolicyRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.mission_policies} FROM mission_policies WHERE mission_id = ?`
          )
          .get(key)
      )
    },
    appendAuditEvent(input: z.input<typeof AppendSchema>): number {
      const p = AppendSchema.parse(input)
      return AuditRowCodec.parse(
        db.db
          .prepare(`INSERT INTO audit_events
        (mission_id, actor, object_kind, object_id, event, before, after, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
        RETURNING ${AXIOM_COLUMNS.audit_events}`)
          .get(
            p.missionId,
            p.actor,
            p.objectKind,
            p.objectId,
            p.event,
            p.before === null ? null : JSON.stringify(p.before),
            p.after === null ? null : JSON.stringify(p.after),
            p.createdAt ?? null
          )
      ).sequence
    },
    listAuditEvents(input: z.input<typeof ListSchema>) {
      const p = ListSchema.parse(input)
      return readRows(
        AuditRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.audit_events} FROM audit_events
        WHERE mission_id = ? AND sequence > ? ORDER BY sequence LIMIT ?`)
          .all(p.missionId, p.afterSequence ?? 0, p.limit ?? -1)
      )
    }
  }
}
