import { z } from 'zod'
import { AcceptanceCriterionSchema, AxiomIdSchema } from './mission-objects'

export const VerificationAcceptanceSchema = AcceptanceCriterionSchema.extend({
  index: z.number().int().nonnegative(),
  result: z.enum(['pass', 'fail', 'inconclusive', 'skipped', 'human']),
  checkIndexes: z.array(z.number().int().nonnegative()),
  artifactIds: z.array(AxiomIdSchema)
}).describe('Independent verification evidence for one resolved acceptance criterion.')

export type VerificationAcceptance = z.infer<typeof VerificationAcceptanceSchema>
