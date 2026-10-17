import { z } from 'zod'
import {
  AxiomIdSchema,
  GoalBodySchema,
  GoalRevisionSchema,
  PlanRevisionSchema
} from '../../../shared/axiom-contract/mission-objects'
import {
  GoalRevisionStatusSchema,
  PlanRevisionStatusSchema
} from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { generateId } from '../../runtime/orchestration/db/generated-id'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import { AXIOM_COLUMNS, GoalRowCodec, PlanRowCodec } from './axiom-rows'
import { readRow, readRows } from './row-codec'

const GoalOptionsSchema = GoalRevisionSchema.pick({ missionId: true, status: true })
const PlanBodySchema = PlanRevisionSchema.pick({
  goalRevisionId: true,
  milestones: true,
  risks: true,
  provenance: true
})
const PlanOptionsSchema = PlanRevisionSchema.pick({
  missionId: true,
  status: true,
  supersedesId: true
})
const GoalStatusSchema = z.object({
  id: AxiomIdSchema,
  from: GoalRevisionStatusSchema,
  to: GoalRevisionStatusSchema
})
const PlanStatusSchema = z.object({
  id: AxiomIdSchema,
  from: PlanRevisionStatusSchema,
  to: PlanRevisionStatusSchema,
  rejectedReason: PlanRevisionSchema.shape.rejectedReason
})

export function revisionsStore(db: OrchestrationDb) {
  return {
    insertGoalRevision(
      body: z.input<typeof GoalBodySchema>,
      options: z.input<typeof GoalOptionsSchema>
    ) {
      const b = GoalBodySchema.parse(body)
      const p = GoalOptionsSchema.parse(options)
      return runLifecycleWriteTransaction(db.db, 'axiom_insert_goal_revision', () =>
        GoalRowCodec.parse(
          db.db
            .prepare(`INSERT INTO goal_revisions
          (id, mission_id, revision, status, objective, constraints, acceptance_criteria, provenance)
          VALUES (?, ?, (SELECT COALESCE(MAX(revision), 0) + 1 FROM goal_revisions WHERE mission_id = ?), ?, ?, ?, ?, ?)
          RETURNING ${AXIOM_COLUMNS.goal_revisions}`)
            .get(
              generateId('goalrev'),
              p.missionId,
              p.missionId,
              p.status,
              b.objective,
              JSON.stringify(b.constraints),
              JSON.stringify(b.acceptanceCriteria),
              JSON.stringify(b.provenance)
            )
        )
      )
    },
    getGoalRevision(id: string) {
      const key = AxiomIdSchema.parse(id)
      return readRow(
        GoalRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.goal_revisions} FROM goal_revisions WHERE id = ?`)
          .get(key)
      )
    },
    listGoalRevisions(missionId: string) {
      const key = AxiomIdSchema.parse(missionId)
      return readRows(
        GoalRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.goal_revisions} FROM goal_revisions WHERE mission_id = ? ORDER BY revision`
          )
          .all(key)
      )
    },
    updateGoalRevisionStatus(input: z.input<typeof GoalStatusSchema>): boolean {
      const p = GoalStatusSchema.parse(input)
      return (
        db.db
          .prepare(`UPDATE goal_revisions SET status = ?, updated_at = datetime('now')
        WHERE id = ? AND status = ?`)
          .run(p.to, p.id, p.from).changes === 1
      )
    },
    insertPlanRevision(
      body: z.input<typeof PlanBodySchema>,
      options: z.input<typeof PlanOptionsSchema>
    ) {
      const b = PlanBodySchema.parse(body)
      const p = PlanOptionsSchema.parse(options)
      return runLifecycleWriteTransaction(db.db, 'axiom_insert_plan_revision', () =>
        PlanRowCodec.parse(
          db.db
            .prepare(`INSERT INTO plan_revisions
          (id, mission_id, revision, status, goal_revision_id, milestones, risks, provenance, supersedes_id)
          VALUES (?, ?, (SELECT COALESCE(MAX(revision), 0) + 1 FROM plan_revisions WHERE mission_id = ?), ?, ?, ?, ?, ?, ?)
          RETURNING ${AXIOM_COLUMNS.plan_revisions}`)
            .get(
              generateId('planrev'),
              p.missionId,
              p.missionId,
              p.status,
              b.goalRevisionId,
              JSON.stringify(b.milestones),
              JSON.stringify(b.risks),
              JSON.stringify(b.provenance),
              p.supersedesId ?? null
            )
        )
      )
    },
    getPlanRevision(id: string) {
      const key = AxiomIdSchema.parse(id)
      return readRow(
        PlanRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.plan_revisions} FROM plan_revisions WHERE id = ?`)
          .get(key)
      )
    },
    listPlanRevisions(missionId: string) {
      const key = AxiomIdSchema.parse(missionId)
      return readRows(
        PlanRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.plan_revisions} FROM plan_revisions WHERE mission_id = ? ORDER BY revision`
          )
          .all(key)
      )
    },
    updatePlanRevisionStatus(input: z.input<typeof PlanStatusSchema>): boolean {
      const p = PlanStatusSchema.parse(input)
      return (
        db.db
          .prepare(`UPDATE plan_revisions SET status = ?,
        rejected_reason = CASE WHEN ? THEN ? ELSE rejected_reason END, updated_at = datetime('now')
        WHERE id = ? AND status = ?`)
          .run(p.to, Number(p.rejectedReason !== undefined), p.rejectedReason ?? null, p.id, p.from)
          .changes === 1
      )
    }
  }
}
