import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AttemptBindingRowCodec, AttemptBindingSchema } from './attempt-binding-rows'
import { readRow, readRows } from './row-codec'

const InsertSchema = AttemptBindingSchema.omit({ createdAt: true, updatedAt: true })
const ListSchema = z.object({ missionId: AxiomIdSchema, taskId: AxiomIdSchema.optional() })
const columns =
  'task_id, mission_id, seq, branch, dispatch_id, agent_spec_id, context_package_id, created_at, updated_at'

export function attemptBindingsStore(db: OrchestrationDb) {
  return {
    insertAttemptBinding(input: z.input<typeof InsertSchema>): void {
      const p = InsertSchema.parse(input)
      db.db
        .prepare(`INSERT INTO attempt_bindings
        (task_id, mission_id, seq, branch, dispatch_id, agent_spec_id, context_package_id)
        VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(
          p.taskId,
          p.missionId,
          p.seq,
          p.branch,
          p.dispatchId,
          p.agentSpecId,
          p.contextPackageId
        )
    },
    bindAttemptDispatch(taskId: string, seq: number, dispatchId: string): boolean {
      return (
        db.db
          .prepare(`UPDATE attempt_bindings SET dispatch_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE task_id = ? AND seq = ? AND dispatch_id IS NULL`)
          .run(
            AxiomIdSchema.parse(dispatchId),
            AxiomIdSchema.parse(taskId),
            AttemptBindingSchema.shape.seq.parse(seq)
          ).changes === 1
      )
    },
    getAttemptBindingByDispatch(dispatchId: string) {
      return readRow(
        AttemptBindingRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM attempt_bindings WHERE dispatch_id = ?`)
          .get(AxiomIdSchema.parse(dispatchId))
      )
    },
    getAttemptBinding(taskId: string, seq: number) {
      return readRow(
        AttemptBindingRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM attempt_bindings WHERE task_id = ? AND seq = ?`)
          .get(AxiomIdSchema.parse(taskId), AttemptBindingSchema.shape.seq.parse(seq))
      )
    },
    listAttemptBindings(input: z.input<typeof ListSchema>) {
      const p = ListSchema.parse(input)
      return readRows(
        AttemptBindingRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM attempt_bindings
        WHERE mission_id = ? AND (? IS NULL OR task_id = ?) ORDER BY task_id, seq`
          )
          .all(p.missionId, p.taskId ?? null, p.taskId ?? null)
      )
    },
    nextAttemptSeq(taskId: string): number {
      return z
        .object({ seq: AttemptBindingSchema.shape.seq })
        .parse(
          db.db
            .prepare(
              'SELECT COALESCE(MAX(seq), 0) + 1 AS seq FROM attempt_bindings WHERE task_id = ?'
            )
            .get(AxiomIdSchema.parse(taskId))
        ).seq
    },
    listPlannerBindings(missionId: string) {
      return readRows(
        AttemptBindingRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM attempt_bindings
          WHERE mission_id = ? AND branch LIKE 'axiom/planner/%' ORDER BY created_at, task_id`)
          .all(AxiomIdSchema.parse(missionId))
      )
    },
    hasPendingQuestionForTask(taskId: string): boolean {
      return (
        db.db
          .prepare(`SELECT 1 FROM question_threads q
        JOIN attempt_bindings b ON b.dispatch_id = q.dispatch_id
        WHERE b.task_id = ? AND q.status = 'pending' LIMIT 1`)
          .get(AxiomIdSchema.parse(taskId)) !== undefined
      )
    },
    countRunningTasksForProvider(missionId: string, provider: string): number {
      return z.object({ count: z.number().int().nonnegative() }).parse(
        db.db
          .prepare(`
        SELECT COUNT(*) AS count FROM task_stages t
        JOIN attempt_bindings b ON b.task_id = t.task_id AND b.mission_id = t.mission_id
        JOIN agent_specs s ON s.id = b.agent_spec_id
        WHERE t.mission_id = ? AND t.stage = 'RUNNING' AND s.provider = ?
          AND b.seq = (SELECT MAX(latest.seq) FROM attempt_bindings latest WHERE latest.task_id = t.task_id)
      `)
          .get(AxiomIdSchema.parse(missionId), z.string().min(1).parse(provider))
      ).count
    }
  }
}
