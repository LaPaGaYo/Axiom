import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

const count = z.number().int().nonnegative()
export const TokenUsageReadingSchema = z.object({
  newTokens: count,
  inputTokens: count,
  cachedInputTokens: count,
  cacheWriteTokens: count,
  outputTokens: count,
  reasoningTokens: count,
  status: z.enum(['complete', 'partial', 'unavailable'])
})
export type TokenUsageReading = z.infer<typeof TokenUsageReadingSchema>

export const AttemptTokenUsageSchema = TokenUsageReadingSchema.extend({
  attemptId: AxiomIdSchema,
  seq: z.number().int().positive(),
  provider: z.string().min(1),
  final: z.boolean(),
  measuredAt: z.iso.datetime()
})
export const MissionUsageParams = z.object({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema.optional()
})
export const MissionUsageResponseSchema = z.object({
  missionId: AxiomIdSchema,
  limit: count.nullable(),
  used: count,
  tasks: z.array(
    z.object({
      taskId: AxiomIdSchema,
      limit: count.nullable(),
      used: count,
      attempts: z.array(AttemptTokenUsageSchema)
    })
  )
})

export function emptyTokenUsage(status: TokenUsageReading['status']): TokenUsageReading {
  return {
    newTokens: 0,
    inputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    status
  }
}
