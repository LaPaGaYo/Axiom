import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { MissionStatusSchema } from './lifecycle'

export const WaitingBudgetSchema = z.strictObject({
  scope: z.enum(['task', 'mission']),
  dimension: z.enum(['maxAttempts', 'maxTokens', 'maxWallClockMinutes']),
  limit: z.number().nonnegative(),
  used: z.number().nonnegative()
})
export const TaskWaitingOnSchema = z.strictObject({
  on: z.enum([
    'none',
    'mission',
    'dependency',
    'question',
    'approval',
    'budget',
    'admission',
    'verification',
    'integration',
    'human',
    'running'
  ]),
  reason: z.string().min(1),
  person: z.boolean(),
  taskIds: z.array(AxiomIdSchema).optional(),
  runId: AxiomIdSchema.optional(),
  seq: z.number().int().positive().optional(),
  budget: WaitingBudgetSchema.optional(),
  until: z.iso.datetime().optional(),
  missionStatus: MissionStatusSchema.optional()
})
export type TaskWaitingOn = z.infer<typeof TaskWaitingOnSchema>
export type WaitingBudget = z.infer<typeof WaitingBudgetSchema>
