import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { VerificationListParams } from '../../../shared/axiom-contract/verification-params'
import {
  VerificationRunStatusSchema,
  isLegalVerificationRunTransition
} from '../../../shared/axiom-contract/lifecycle'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import {
  VerificationRunSchema,
  VerificationRunRowSchema,
  VerificationRunRowCodec
} from './submission-rows'
import { readRow, readRows } from './row-codec'

const columns = Object.keys(VerificationRunRowSchema.shape).join(', ')
const Insert = VerificationRunSchema.omit({
  createdAt: true,
  updatedAt: true,
  runtimeEpoch: true,
  claimCount: true,
  worktreeId: true,
  startedAt: true,
  finishedAt: true
})
const Claim = z.object({
  id: AxiomIdSchema,
  runtimeEpoch: z.string().min(1),
  startedAt: z.string().min(1)
})
const Update = VerificationRunSchema.pick({
  status: true,
  verdictDetail: true,
  runtimeEpoch: true,
  worktreeId: true,
  commands: true,
  toolVersions: true,
  finishedAt: true
})
  .partial()
  .extend({
    id: AxiomIdSchema,
    expectedStatus: VerificationRunStatusSchema,
    expectedRuntimeEpoch: z.string().nullable().optional(),
    expectedClaimCount: z.number().int().nonnegative().optional()
  })
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
    claimVerificationRun(input: z.input<typeof Claim>) {
      const p = Claim.parse(input)
      const result = db.db
        .prepare(`UPDATE verification_runs SET status = 'RUNNING',
        runtime_epoch = ?, claim_count = claim_count + 1, started_at = ?, finished_at = NULL,
        verifier = 'VerificationService', verdict_detail = json_object('phase', 'claimed', 'claim', claim_count + 1),
        updated_at = datetime('now') WHERE id = ? AND status = 'QUEUED'`)
        .run(p.runtimeEpoch, p.startedAt, p.id)
      if (result.changes !== 1) {
        return undefined
      }
      return VerificationRunRowCodec.parse(
        db.db.prepare(`SELECT ${columns} FROM verification_runs WHERE id = ?`).get(p.id)
      )
    },
    updateVerificationRun(input: z.input<typeof Update>) {
      const p = Update.parse(input)
      if (p.status !== undefined && !isLegalVerificationRunTransition(p.expectedStatus, p.status)) {
        return false
      }
      const fields = {
        status: p.status,
        verdict_detail: p.verdictDetail === undefined ? undefined : JSON.stringify(p.verdictDetail),
        runtime_epoch: p.runtimeEpoch,
        worktree_id: p.worktreeId,
        commands: p.commands === undefined ? undefined : JSON.stringify(p.commands),
        tool_versions: p.toolVersions === undefined ? undefined : JSON.stringify(p.toolVersions),
        finished_at: p.finishedAt
      }
      const entries = Object.entries(fields).filter(
        (entry): entry is [string, string | null] => entry[1] !== undefined
      )
      if (!entries.length) {
        return false
      }
      return (
        db.db
          .prepare(`UPDATE verification_runs SET ${entries.map(([key]) => `${key} = ?`).join(', ')}, updated_at = datetime('now')
        WHERE id = ? AND status = ?
        ${p.expectedRuntimeEpoch === undefined ? '' : 'AND runtime_epoch IS ?'}
        ${p.expectedClaimCount === undefined ? '' : 'AND claim_count = ?'}`)
          .run(
            ...entries.map(([, value]) => value),
            p.id,
            p.expectedStatus,
            ...(p.expectedRuntimeEpoch === undefined ? [] : [p.expectedRuntimeEpoch]),
            ...(p.expectedClaimCount === undefined ? [] : [p.expectedClaimCount])
          ).changes === 1
      )
    },
    listVerificationRunsByStatus(status: z.input<typeof VerificationRunStatusSchema>) {
      return readRows(
        VerificationRunRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM verification_runs WHERE status = ? ORDER BY created_at, id`
          )
          .all(VerificationRunStatusSchema.parse(status))
      )
    },
    listVerificationRuns(input: z.input<typeof VerificationListParams>) {
      const p = VerificationListParams.parse(input)
      return readRows(
        VerificationRunRowCodec,
        db.db
          .prepare(
            `SELECT ${columns} FROM verification_runs WHERE mission_id = ? AND (? IS NULL OR status = ?) AND (? IS NULL OR task_id = ?) AND (? IS NULL OR candidate_id = ?) ORDER BY created_at, id`
          )
          .all(
            p.missionId,
            p.status ?? null,
            p.status ?? null,
            p.taskId ?? null,
            p.taskId ?? null,
            p.candidateId ?? null,
            p.candidateId ?? null
          )
      )
    }
  }
}
