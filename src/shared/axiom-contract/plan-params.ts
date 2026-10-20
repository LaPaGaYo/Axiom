import { z } from 'zod'
import { requiredString } from '../rpc-contract/rpc-param-primitives'
import { AxiomIdSchema, ProvenanceSchema, PlanRevisionSchema } from './mission-objects'
import { PlanProposalSchema } from './plan-proposal'

// §4c keeps provenance beside planRevision; validatePlanProposal receives their
// combination. Shape parsing alone does not replace the controller's DAG check.
export const PlanProposeParams = z
  .object({
    missionId: AxiomIdSchema,
    planRevision: PlanProposalSchema.omit({ provenance: true }),
    provenance: ProvenanceSchema.optional(),
    attemptId: AxiomIdSchema.optional(),
    from: z.string().min(1).optional()
  })
  .superRefine((p, ctx) => {
    if ((p.provenance === undefined) === (p.attemptId === undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Supply exactly one of provenance or attemptId.' })
    }
  })
export const PlanApproveParams = z.object({
  planRevisionId: AxiomIdSchema,
  resolver: requiredString('Missing resolver')
})
export const PlanRejectParams = PlanApproveParams.extend({
  reason: requiredString('Missing reason')
})
export const PlanListParams = z.object({ missionId: AxiomIdSchema })
export const PlanShowParams = z.object({ planRevisionId: AxiomIdSchema })

export const PlanResponseSchema = z.object({ planRevision: PlanRevisionSchema })
export const PlanListResponseSchema = z.object({ planRevisions: z.array(PlanRevisionSchema) })
export type PlanResponse = z.infer<typeof PlanResponseSchema>
export type PlanListResponse = z.infer<typeof PlanListResponseSchema>
