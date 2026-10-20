import type { z } from 'zod'
import { CandidateSchema } from '../../../shared/axiom-contract/submission-params'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { CandidateRowCodec, CandidateRowSchema } from './submission-rows'
import { readRow, readRows } from './row-codec'

const columns = Object.keys(CandidateRowSchema.shape).join(', ')
const Insert = CandidateSchema.omit({ createdAt: true, updatedAt: true })
export function candidatesStore(db: OrchestrationDb) {
  return {
    insertCandidate(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      if (
        db.db
          .prepare('SELECT id FROM candidates WHERE task_id = ? AND commit_sha = ?')
          .get(p.taskId, p.commitSha)
      ) {
        throw new OrchestrationError('invalid_argument', 'candidate_exists')
      }
      db.db
        .prepare(`INSERT INTO candidates
        (id, mission_id, dispatch_id, task_id, commit_sha, tree_sha, status, superseded_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          p.id,
          p.missionId,
          p.attemptId,
          p.taskId,
          p.commitSha,
          p.treeSha,
          p.status,
          p.supersededBy
        )
      return CandidateRowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM candidates WHERE id = ?`).get(p.id)
      )
    },
    getCandidate(id: string) {
      return readRow(
        CandidateRowCodec,
        db.db.prepare(`SELECT ${columns} FROM candidates WHERE id = ?`).get(AxiomIdSchema.parse(id))
      )
    },
    listCandidates(missionId: string) {
      return readRows(
        CandidateRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM candidates WHERE mission_id = ? ORDER BY created_at, id`)
          .all(AxiomIdSchema.parse(missionId))
      )
    },
    supersedeActiveCandidates(taskId: string, supersededBy: string) {
      const previous = readRows(
        CandidateRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM candidates WHERE task_id = ? AND status = 'ACTIVE' AND id != ?`
          )
          .all(AxiomIdSchema.parse(taskId), AxiomIdSchema.parse(supersededBy))
      )
      db.db
        .prepare(
          `UPDATE candidates SET status = 'SUPERSEDED', superseded_by = ?, updated_at = datetime('now') WHERE task_id = ? AND status = 'ACTIVE' AND id != ?`
        )
        .run(supersededBy, taskId, supersededBy)
      return previous
    }
  }
}
