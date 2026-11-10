import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import {
  AttemptDispatchPayloadSchema,
  AttemptContinuePayloadSchema,
  EffectKindSchema,
  EffectSchema,
  EffectStatusSchema,
  EffectTimestampSchema,
  VerificationEnqueuePayloadSchema
} from '../../../shared/axiom-contract/effects'
import { readJson } from './row-codec'

export const EffectRowSchema = z.object({
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  kind: EffectKindSchema,
  effect_key: z.string().min(1),
  payload: z.string(),
  status: EffectStatusSchema,
  due_at: EffectTimestampSchema,
  attempts: z.number().int().nonnegative(),
  lease_epoch: z.string().min(1).nullable(),
  last_error: z.string().nullable(),
  created_at: z.string().min(1),
  updated_at: z.string().min(1)
})
export const EffectRowCodec = EffectRowSchema.transform((row) =>
  EffectSchema.parse({
    id: row.id,
    missionId: row.mission_id,
    kind: row.kind,
    key: row.effect_key,
    payload:
      row.kind === 'attempt.dispatch'
        ? readJson(AttemptDispatchPayloadSchema, row.payload, 'axiom_effects', row.id, 'payload')
        : row.kind === 'attempt.continue'
          ? readJson(AttemptContinuePayloadSchema, row.payload, 'axiom_effects', row.id, 'payload')
          : readJson(
              VerificationEnqueuePayloadSchema,
              row.payload,
              'axiom_effects',
              row.id,
              'payload'
            ),
    status: row.status,
    dueAt: row.due_at,
    attempts: row.attempts,
    leaseEpoch: row.lease_epoch,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  })
)
