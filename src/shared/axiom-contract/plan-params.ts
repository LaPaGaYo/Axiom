import { z } from 'zod'
import { requiredString } from '../rpc-contract/rpc-param-primitives'
import { AxiomIdSchema, ProvenanceSchema } from './mission-objects'
import { PlanProposalSchema } from './plan-proposal'

// §4c keeps provenance beside planRevision; validatePlanProposal receives their
// combination. Shape parsing alone does not replace the controller's DAG check.
export const PlanProposeParams = z.object({
  missionId: AxiomIdSchema,
  planRevision: PlanProposalSchema.omit({ provenance: true }),
  provenance: ProvenanceSchema
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
