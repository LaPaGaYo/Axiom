import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

export const ApprovalGrantParams = z.strictObject({ approvalId: AxiomIdSchema })
export const ApprovalDenyParams = ApprovalGrantParams.extend({
  reason: z.string().trim().min(1).max(2000)
})
