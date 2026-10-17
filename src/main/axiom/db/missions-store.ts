import { z } from 'zod'
import {
  AxiomIdSchema,
  MissionSchema,
  type Mission
} from '../../../shared/axiom-contract/mission-objects'
import { MissionStatusSchema } from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AXIOM_COLUMNS, MissionRowCodec } from './axiom-rows'
import { readRow, readRows } from './row-codec'

const ListSchema = z.object({
  repoId: AxiomIdSchema.optional(),
  status: MissionStatusSchema.optional(),
  cursor: AxiomIdSchema.optional(),
  limit: z.number().int().positive().optional()
})
const StatusSchema = z.object({
  id: AxiomIdSchema,
  from: MissionStatusSchema,
  to: MissionStatusSchema,
  previousStatus: MissionStatusSchema.nullable()
})
const RevisionsSchema = MissionSchema.pick({ id: true }).extend({
  activeGoalRevisionId: AxiomIdSchema.nullable().optional(),
  activePlanRevisionId: AxiomIdSchema.nullable().optional()
})

export function missionsStore(db: OrchestrationDb) {
  return {
    updateRunObjective(runId: string, objective: string): void {
      db.db
        .prepare('UPDATE runs SET objective = ? WHERE id = ?')
        .run(z.string().min(1).parse(objective), AxiomIdSchema.parse(runId))
    },
    insertMission(mission: Mission): void {
      const m = MissionSchema.parse(mission)
      db.db
        .prepare(`INSERT INTO missions
        (id, run_id, coordinator_orca_session_id, repo_id, repo_path, target_branch, status,
         active_goal_revision_id, active_plan_revision_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          m.id,
          m.runId,
          m.coordinatorOrcaSessionId,
          m.repoId,
          m.repoPath,
          m.targetBranch,
          m.status,
          m.activeGoalRevisionId,
          m.activePlanRevisionId
        )
    },
    getMission(id: string) {
      const key = AxiomIdSchema.parse(id)
      return readRow(
        MissionRowCodec,
        db.db.prepare(`SELECT ${AXIOM_COLUMNS.missions} FROM missions WHERE id = ?`).get(key)
      )
    },
    getMissionByRunId(runId: string) {
      const key = AxiomIdSchema.parse(runId)
      return readRow(
        MissionRowCodec,
        db.db.prepare(`SELECT ${AXIOM_COLUMNS.missions} FROM missions WHERE run_id = ?`).get(key)
      )
    },
    getMissionBySessionId(coordinatorOrcaSessionId: string) {
      const key = AxiomIdSchema.parse(coordinatorOrcaSessionId)
      return readRow(
        MissionRowCodec,
        db.db
          .prepare(
            `SELECT ${AXIOM_COLUMNS.missions} FROM missions WHERE coordinator_orca_session_id = ?`
          )
          .get(key)
      )
    },
    listMissions(input: z.input<typeof ListSchema>) {
      const p = ListSchema.parse(input)
      return readRows(
        MissionRowCodec,
        db.db
          .prepare(`SELECT ${AXIOM_COLUMNS.missions} FROM missions
        WHERE (? IS NULL OR repo_id = ?) AND (? IS NULL OR status = ?)
          AND (? IS NULL OR (created_at, id) > (SELECT created_at, id FROM missions WHERE id = ?))
        ORDER BY created_at, id LIMIT ?`)
          .all(
            p.repoId ?? null,
            p.repoId ?? null,
            p.status ?? null,
            p.status ?? null,
            p.cursor ?? null,
            p.cursor ?? null,
            p.limit ?? -1
          )
      )
    },
    updateMissionStatus(input: z.input<typeof StatusSchema>): boolean {
      const p = StatusSchema.parse(input)
      return (
        db.db
          .prepare(`UPDATE missions SET status = ?, previous_status = ?, updated_at = datetime('now')
        WHERE id = ? AND status = ?`)
          .run(p.to, p.previousStatus, p.id, p.from).changes === 1
      )
    },
    setActiveRevisions(input: z.input<typeof RevisionsSchema>): void {
      const p = RevisionsSchema.parse(input)
      db.db
        .prepare(`UPDATE missions SET
        active_goal_revision_id = CASE WHEN ? THEN ? ELSE active_goal_revision_id END,
        active_plan_revision_id = CASE WHEN ? THEN ? ELSE active_plan_revision_id END,
        updated_at = datetime('now') WHERE id = ?`)
        .run(
          Number(p.activeGoalRevisionId !== undefined),
          p.activeGoalRevisionId ?? null,
          Number(p.activePlanRevisionId !== undefined),
          p.activePlanRevisionId ?? null,
          p.id
        )
    }
  }
}
