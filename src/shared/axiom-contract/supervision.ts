import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

export const StallModeSchema = z.enum(['observe', 'notify', 'stop'])
export type StallMode = z.infer<typeof StallModeSchema>
export const SupervisionShowParams = z.strictObject({ missionId: AxiomIdSchema.optional() })
export const SupervisionUpdateParams = z.strictObject({
  rule: z.literal('stalled'),
  missionId: AxiomIdSchema.optional(),
  mode: StallModeSchema.nullable()
})

export const StallNotificationSchema = z.strictObject({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  attemptId: AxiomIdSchema,
  idleMs: z.number().nonnegative(),
  thresholdMs: z.number().positive(),
  thresholdSource: z.enum(['measured', 'default', 'e2e']),
  lastEventAt: z.iso.datetime(),
  notifiedAt: z.string().min(1)
})
export const SupervisionRuleSchema = z.strictObject({
  rule: z.literal('stalled'),
  globalMode: StallModeSchema,
  globalSource: z.enum(['built_in', 'user']),
  missionMode: StallModeSchema.nullable().optional(),
  effectiveMode: StallModeSchema.optional()
})
// The dispatcher adds mutation receipt metadata to update results; decode the domain view.
export const SupervisionShowResponse = z.object({
  rules: z.array(SupervisionRuleSchema).length(1),
  notifications: z.array(StallNotificationSchema)
})
export const SupervisionUpdateResponse = SupervisionShowResponse
