import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { VerificationRunStatusSchema } from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import {
  VerificationRunSchema,
  VerificationRunRowSchema,
  VerificationRunRowCodec
} from './submission-rows'
import { readRow, readRows } from './row-codec'

const columns = Object.keys(VerificationRunRowSchema.shape).join(', ')
const Insert = VerificationRunSchema.omit({ createdAt: true, updatedAt: true })
const List = z.object({ missionId: AxiomIdSchema, status: VerificationRunStatusSchema.optional() })
export function verificationRunsStore(db: OrchestrationDb) {
  return {
    insertVerificationRun(input: z.input<typeof Insert>) {
      const p = Insert.parse(input)
      db.db
        .prepare(`INSERT INTO verification_runs
        (id, mission_id, candidate_id, task_id, status, verdict_detail, commands, tool_versions, verifier)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(
          p.id,
          p.missionId,
          p.candidateId,
          p.taskId,
          p.status,
          JSON.stringify(p.verdictDetail),
          JSON.stringify(p.commands),
          JSON.stringify(p.toolVersions),
          p.verifier
        )
      return VerificationRunRowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM verification_runs WHERE id = ?`).get(p.id)
      )
    },
    getVerificationRun(id: string) {
      return readRow(
        VerificationRunRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM verification_runs WHERE id = ?`)
          .get(AxiomIdSchema.parse(id))
      )
    },
    listVerificationRuns(input: z.input<typeof List>) {
      const p = List.parse(input)
      return readRows(
        VerificationRunRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM verification_runs WHERE mission_id = ? AND (? IS NULL OR status = ?) ORDER BY created_at, id`
          )
          .all(p.missionId, p.status ?? null, p.status ?? null)
      )
    }
  }
}
