import { z } from 'zod'
import { AxiomIdSchema, PolicySchema, RoutingPolicySchema } from './mission-objects'
import { VerificationRulesSchema } from './verification-rules'

export const PolicyShowParams = z.strictObject({ missionId: AxiomIdSchema })
export const PolicyUpdateParams = PolicyShowParams.extend({
  patch: z.strictObject({
    routing: RoutingPolicySchema.optional(),
    verificationRules: VerificationRulesSchema.optional(),
    concurrencyLimit: z.number().int().positive().optional(),
    // Why: preserve presence for the handler's approval_required pre-check. Zod rejection
    // is always invalid_argument in the dispatcher; no budget value is ever applied here.
    budget: z.unknown().optional()
  })
})
export const PolicyResponseSchema = z.object({ policy: PolicySchema })
