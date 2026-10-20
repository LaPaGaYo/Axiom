import type { z } from 'zod'
import { SubmissionSchema } from '../../../shared/axiom-contract/submission-params'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { SubmissionRowCodec, SubmissionRowSchema } from './submission-rows'
import { readRow, readRows } from './row-codec'

const columns = Object.keys(SubmissionRowSchema.shape).join(', ')
const Insert = SubmissionSchema.omit({
  createdAt: true,
  checksRun: true,
  limitations: true,
  followUps: true
})
export function submissionsStore(db: OrchestrationDb) {
  return {
    insertSubmission(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      db.db
        .prepare(`INSERT INTO submissions
        (id, mission_id, dispatch_id, task_id, candidate_id, report, checks_run, limitations, follow_ups)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          p.id,
          p.missionId,
          p.attemptId,
          p.taskId,
          p.candidateId,
          JSON.stringify(p.report),
          JSON.stringify(p.report.checksRun),
          JSON.stringify(p.report.limitations),
          JSON.stringify(p.report.followUps)
        )
      return SubmissionRowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM submissions WHERE id = ?`).get(p.id)
      )
    },
    getSubmissionByDispatch(attemptId: string) {
      return readRow(
        SubmissionRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM submissions WHERE dispatch_id = ?`)
          .get(AxiomIdSchema.parse(attemptId))
      )
    },
    listSubmissions(missionId: string) {
      return readRows(
        SubmissionRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM submissions WHERE mission_id = ? ORDER BY created_at, id`
          )
          .all(AxiomIdSchema.parse(missionId))
      )
    }
  }
}
