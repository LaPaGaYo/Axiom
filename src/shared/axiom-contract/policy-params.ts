import { z } from 'zod'
import {
  AxiomIdSchema,
  PolicySchema,
  RoutingPolicySchema,
  TuiAgentIdSchema
} from './mission-objects'
import { VerificationRulesSchema } from './verification-rules'
import { ReadinessThresholdSchema } from './lifecycle'
import { ProviderFilterReasonSchema } from './agent-spec'

export const PolicyShowParams = z.strictObject({
  missionId: AxiomIdSchema,
  // Host detection is opt-in so the Mission page's periodic policy read stays inexpensive.
  providers: z.boolean().optional()
})
export const PolicyUpdateParams = z.strictObject({
  missionId: AxiomIdSchema,
  patch: z.strictObject({
    routing: RoutingPolicySchema.optional(),
    verificationRules: VerificationRulesSchema.optional(),
    concurrencyLimit: z.number().int().positive().optional(),
    readinessThreshold: ReadinessThresholdSchema.optional(),
    // Why: preserve presence for the controller's approval_required pre-check. Zod rejection
    // is always invalid_argument in the dispatcher; no budget value is ever applied here.
    budget: z.unknown().optional()
  })
})
const ProviderEligibilitySlotSchema = z.strictObject({
  eligible: z.boolean(),
  reason: ProviderFilterReasonSchema.optional()
})
export const ProviderEligibilitySchema = z.strictObject({
  provider: TuiAgentIdSchema,
  planner: ProviderEligibilitySlotSchema,
  worker: z.strictObject({
    low: ProviderEligibilitySlotSchema,
    medium: ProviderEligibilitySlotSchema,
    high: ProviderEligibilitySlotSchema
  })
})
export const PolicyResponseSchema = z.object({
  policy: PolicySchema,
  providers: z.array(ProviderEligibilitySchema).optional()
})
