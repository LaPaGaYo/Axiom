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
export const SupervisionResolveParams = z.strictObject({
  proposalId: AxiomIdSchema,
  resolution: z.enum(['accept', 'dismiss'])
})
export const SupervisionEvidenceSchema = z.strictObject({
  hits: z.number().int().nonnegative(),
  falsePositives: z.number().int().nonnegative(),
  known: z.number().int().nonnegative(),
  inconclusive: z.number().int().nonnegative(),
  hitRate: z.number().min(0).max(1).nullable(),
  savedMs: z.number().nonnegative(),
  sinceSequence: z.number().int().nonnegative(),
  throughSequence: z.number().int().nonnegative()
})
export const SupervisionProposalSchema = z.strictObject({
  id: AxiomIdSchema,
  rule: z.literal('stalled'),
  fromMode: StallModeSchema,
  toMode: StallModeSchema,
  status: z.enum(['OPEN', 'ACCEPTED', 'DISMISSED', 'SUPERSEDED']),
  evidence: SupervisionEvidenceSchema,
  sinceSequence: z.number().int().nonnegative(),
  throughSequence: z.number().int().nonnegative(),
  resolver: z.string().nullable(),
  createdAt: z.string().min(1),
  resolvedAt: z.string().nullable()
})
export const StallReconciliationSchema = z.object({
  rule: z.literal('stalled'),
  mode: z.enum(['observe', 'notify']),
  observationSequence: z.number().int().positive(),
  outcome: z.enum(['hit', 'false_positive', 'inconclusive']),
  endedBy: z.enum([
    'timeout',
    'failed',
    'unchanged',
    'verification_pass',
    'verification_fail',
    'interrupted',
    'declared',
    'stopped',
    'abandoned',
    'canceled_runs',
    'unknown'
  ]),
  endedAt: z.iso.datetime(),
  savedMs: z.number().nonnegative().optional()
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
  globalSource: z.enum(['built_in', 'user', 'proposal']),
  missionMode: StallModeSchema.nullable().optional(),
  effectiveMode: StallModeSchema.optional()
})
// The dispatcher adds mutation receipt metadata to update results; decode the domain view.
export const SupervisionShowResponse = z.object({
  rules: z.array(SupervisionRuleSchema).length(1),
  notifications: z.array(StallNotificationSchema),
  evidence: z.array(
    z.strictObject({
      rule: z.literal('stalled'),
      window: SupervisionEvidenceSchema,
      total: SupervisionEvidenceSchema
    })
  ),
  proposals: z.array(SupervisionProposalSchema)
})
export const SupervisionUpdateResponse = SupervisionShowResponse
export const SupervisionResolveResponse = SupervisionShowResponse
