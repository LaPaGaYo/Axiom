import { z } from 'zod'
import { AxiomIdSchema, TuiAgentIdSchema } from './mission-objects'
import { FailureClassSchema } from './attempt-failure'

export const EFFECT_KINDS = [
  'attempt.dispatch',
  'verification.enqueue',
  'attempt.continue'
] as const
export const EffectKindSchema = z.enum(EFFECT_KINDS)
export const EffectStatusSchema = z.enum(['pending', 'running', 'done', 'failed', 'retired'])
export const EffectTimestampSchema = z.iso.datetime({ offset: true })
export const AttemptDispatchPayloadSchema = z.strictObject({
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  branch: z.string().min(1),
  agentSpecId: AxiomIdSchema,
  contextPackageId: AxiomIdSchema
})
export const VerificationEnqueuePayloadSchema = z.strictObject({ runId: AxiomIdSchema })
export const AttemptContinuePayloadSchema = z.strictObject({
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  chain: z.number().int().positive(),
  failureClass: FailureClassSchema,
  resetsAt: EffectTimestampSchema.optional(),
  account: z.strictObject({ provider: TuiAgentIdSchema, key: z.string().min(1) }).optional()
})

const identity = { missionId: AxiomIdSchema, key: z.string().min(1) }
const dispatch = { kind: z.literal('attempt.dispatch'), payload: AttemptDispatchPayloadSchema }
const verification = {
  kind: z.literal('verification.enqueue'),
  payload: VerificationEnqueuePayloadSchema
}
const continuation = { kind: z.literal('attempt.continue'), payload: AttemptContinuePayloadSchema }
const state = {
  ...identity,
  id: AxiomIdSchema,
  status: EffectStatusSchema,
  dueAt: EffectTimestampSchema,
  attempts: z.number().int().nonnegative(),
  leaseEpoch: z.string().min(1).nullable(),
  lastError: z.string().nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
}
export const EffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...state, ...dispatch }),
  z.strictObject({ ...state, ...verification }),
  z.strictObject({ ...state, ...continuation })
])
export const EnqueueEffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...identity, ...dispatch, dueAt: EffectTimestampSchema.optional() }),
  z.strictObject({ ...identity, ...verification, dueAt: EffectTimestampSchema.optional() }),
  z.strictObject({ ...identity, ...continuation, dueAt: EffectTimestampSchema.optional() })
])
export const EffectListParams = z.strictObject({
  missionId: AxiomIdSchema,
  status: EffectStatusSchema.optional()
})
export const EffectListResponseSchema = z.strictObject({ effects: z.array(EffectSchema) })
export type EffectKind = z.infer<typeof EffectKindSchema>
export type EffectStatus = z.infer<typeof EffectStatusSchema>
export type Effect = z.infer<typeof EffectSchema>
export type EffectOf<K extends EffectKind> = Extract<Effect, { kind: K }>
export type EnqueueEffect = z.input<typeof EnqueueEffectSchema>
export type EffectListResponse = z.infer<typeof EffectListResponseSchema>
