import { z } from 'zod'
import {
  AxiomIdSchema,
  TaskEdgeSchema,
  TaskStageRecordSchema,
  type TaskEdge
} from '../../../shared/axiom-contract/mission-objects'
import {
  TASK_STAGES,
  TaskStageSchema,
  type TaskStage
} from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import { AXIOM_COLUMNS, EdgeRowCodec, TaskStageRowCodec } from './axiom-rows'
import { readRow, readRows } from './row-codec'

const InsertSchema = TaskStageRecordSchema.omit({ updatedAt: true })
const ListSchema = z.object({
  missionId: AxiomIdSchema,
  stage: TaskStageSchema.optional(),
  planRevisionId: AxiomIdSchema.optional()
})
const UpdateSchema = z.object({
  taskId: AxiomIdSchema,
  from: TaskStageSchema,
  to: TaskStageSchema,
  previousStage: TaskStageSchema.nullable().optional(),
  attemptCountDelta: z.number().int().nonnegative().optional()
})
const CountsSchema = z.record(TaskStageSchema, z.number().int().nonnegative())
const CountRowSchema = z.object({ stage: TaskStageSchema, count: z.number().int().nonnegative() })

export function taskGraphStore(db: OrchestrationDb) {
  return {
    insertTaskStage(record: z.input<typeof InsertSchema>): void {
      const p = InsertSchema.parse(record)
      db.db
        .prepare(`INSERT INTO task_stages
        (task_id, mission_id, plan_revision_id, stage, previous_stage, spec, retry_policy, attempt_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          p.taskId,
          p.missionId,
          p.planRevisionId,
          p.stage,
          p.previousStage,
          JSON.stringify(p.spec),
          JSON.stringify(p.retryPolicy),
          p.attemptCount
        )
    },
    getTaskStage(taskId: string) {
      const key = AxiomIdSchema.parse(taskId)
      return readRow(
        TaskStageRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.task_stages} FROM task_stages WHERE task_id = ?`)
          .get(key)
      )
    },
    listTaskStages(input: z.input<typeof ListSchema>) {
      const p = ListSchema.parse(input)
      return readRows(
        TaskStageRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.task_stages} FROM task_stages
        WHERE mission_id = ? AND (? IS NULL OR stage = ?) AND (? IS NULL OR plan_revision_id = ?)
        ORDER BY task_id`)
          .all(
            p.missionId,
            p.stage ?? null,
            p.stage ?? null,
            p.planRevisionId ?? null,
            p.planRevisionId ?? null
          )
      )
    },
    updateTaskStage(input: z.input<typeof UpdateSchema>): boolean {
      const p = UpdateSchema.parse(input)
      return (
        db.db
          .prepare(`UPDATE task_stages SET stage = ?,
        previous_stage = CASE WHEN ? THEN ? ELSE previous_stage END,
        attempt_count = attempt_count + ?, updated_at = datetime('now') WHERE task_id = ? AND stage = ?`)
          .run(
            p.to,
            Number(p.previousStage !== undefined),
            p.previousStage ?? null,
            p.attemptCountDelta ?? 0,
            p.taskId,
            p.from
          ).changes === 1
      )
    },
    countTaskStages(missionId: string): Record<TaskStage, number> {
      const key = AxiomIdSchema.parse(missionId)
      const counts = CountsSchema.parse(Object.fromEntries(TASK_STAGES.map((stage) => [stage, 0])))
      const rows = readRows(
        CountRowSchema,
        db.db
          .prepare(
            'SELECT stage, COUNT(*) AS count FROM task_stages WHERE mission_id = ? GROUP BY stage'
          )
          .all(key)
      )
      for (const row of rows) {
        counts[row.stage] = row.count
      }
      return counts
    },
    insertTaskEdges(missionId: string, planRevisionId: string, edges: TaskEdge[]): void {
      const m = AxiomIdSchema.parse(missionId)
      const p = AxiomIdSchema.parse(planRevisionId)
      const values = z.array(TaskEdgeSchema).parse(edges)
      runLifecycleWriteTransaction(db.db, 'axiom_insert_task_edges', () => {
        // One statement with a fixed parameter count, even for large Task graphs.
        db.db
          .prepare(`INSERT INTO mission_task_edges
          (mission_id, plan_revision_id, from_task_id, to_task_id, readiness_threshold)
          SELECT ?, ?, json_extract(value, '$.fromTaskId'), json_extract(value, '$.toTaskId'),
            json_extract(value, '$.readinessThreshold') FROM json_each(?)`)
          .run(m, p, JSON.stringify(values))
      })
    },
    listTaskEdges(missionId: string) {
      const key = AxiomIdSchema.parse(missionId)
      return readRows(
        EdgeRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.mission_task_edges} FROM mission_task_edges WHERE mission_id = ? ORDER BY from_task_id, to_task_id`
          )
          .all(key)
      )
    },
    listUpstreamEdges(taskId: string) {
      const key = AxiomIdSchema.parse(taskId)
      return readRows(
        EdgeRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.mission_task_edges} FROM mission_task_edges WHERE to_task_id = ? ORDER BY from_task_id`
          )
          .all(key)
      )
    },
    listDownstreamEdges(taskId: string) {
      const key = AxiomIdSchema.parse(taskId)
      return readRows(
        EdgeRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.mission_task_edges} FROM mission_task_edges WHERE from_task_id = ? ORDER BY to_task_id`
          )
          .all(key)
      )
    }
  }
}
