import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import {
  AttemptTokenUsageSchema,
  TokenUsageReadingSchema
} from '../../../shared/axiom-contract/token-usage'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { readRow, readRows } from './row-codec'

export const AttemptTokenUsageRecordSchema = AttemptTokenUsageSchema.extend({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema
})
const count = TokenUsageReadingSchema.shape.newTokens
export const AttemptTokenUsageRowSchema = z.object({
  dispatch_id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  task_id: AxiomIdSchema,
  seq: AttemptTokenUsageSchema.shape.seq,
  provider: AttemptTokenUsageSchema.shape.provider,
  new_tokens: count,
  input_tokens: count,
  cached_input_tokens: count,
  cache_write_tokens: count,
  output_tokens: count,
  reasoning_tokens: count,
  status: TokenUsageReadingSchema.shape.status,
  final: z.union([z.literal(0), z.literal(1)]),
  measured_at: z.iso.datetime()
})
export const AttemptTokenUsageRowCodec = AttemptTokenUsageRowSchema.transform((row) => ({
  attemptId: row.dispatch_id,
  missionId: row.mission_id,
  taskId: row.task_id,
  seq: row.seq,
  provider: row.provider,
  newTokens: row.new_tokens,
  inputTokens: row.input_tokens,
  cachedInputTokens: row.cached_input_tokens,
  cacheWriteTokens: row.cache_write_tokens,
  outputTokens: row.output_tokens,
  reasoningTokens: row.reasoning_tokens,
  status: row.status,
  final: row.final === 1,
  measuredAt: row.measured_at
}))
const columns = Object.keys(AttemptTokenUsageRowSchema.shape).join(', ')
const Scope = z
  .object({ missionId: AxiomIdSchema.optional(), taskId: AxiomIdSchema.optional() })
  .refine((p) => p.missionId !== undefined || p.taskId !== undefined)
const where = 'WHERE (? IS NULL OR mission_id = ?) AND (? IS NULL OR task_id = ?)'

export function attemptTokenUsageStore(db: OrchestrationDb) {
  return {
    upsertAttemptTokenUsage(input: z.input<typeof AttemptTokenUsageRecordSchema>): boolean {
      const p = AttemptTokenUsageRecordSchema.parse(input)
      return (
        db.db
          .prepare(`INSERT INTO attempt_token_usage (${columns})
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(dispatch_id) DO UPDATE SET
          new_tokens = excluded.new_tokens, input_tokens = excluded.input_tokens,
          cached_input_tokens = excluded.cached_input_tokens, cache_write_tokens = excluded.cache_write_tokens,
          output_tokens = excluded.output_tokens, reasoning_tokens = excluded.reasoning_tokens,
          status = excluded.status, final = excluded.final, measured_at = excluded.measured_at
        WHERE attempt_token_usage.final = 0`)
          .run(
            p.attemptId,
            p.missionId,
            p.taskId,
            p.seq,
            p.provider,
            p.newTokens,
            p.inputTokens,
            p.cachedInputTokens,
            p.cacheWriteTokens,
            p.outputTokens,
            p.reasoningTokens,
            p.status,
            Number(p.final),
            p.measuredAt
          ).changes === 1
      )
    },
    getAttemptTokenUsage(attemptId: string) {
      return readRow(
        AttemptTokenUsageRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM attempt_token_usage WHERE dispatch_id = ?`)
          .get(AxiomIdSchema.parse(attemptId))
      )
    },
    listAttemptTokenUsage(input: z.input<typeof Scope>) {
      const p = Scope.parse(input)
      return readRows(
        AttemptTokenUsageRowCodec,
        db.db
          .prepare(`SELECT ${columns} FROM attempt_token_usage ${where} ORDER BY seq, dispatch_id`)
          .all(p.missionId ?? null, p.missionId ?? null, p.taskId ?? null, p.taskId ?? null)
      )
    },
    sumAttemptTokenUsage(input: z.input<typeof Scope>): number {
      const p = Scope.parse(input)
      return z
        .object({ used: count })
        .parse(
          db.db
            .prepare(
              `SELECT COALESCE(SUM(new_tokens), 0) AS used FROM attempt_token_usage ${where}`
            )
            .get(p.missionId ?? null, p.missionId ?? null, p.taskId ?? null, p.taskId ?? null)
        ).used
    }
  }
}
