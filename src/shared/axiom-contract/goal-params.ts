import { z } from 'zod'
import { AxiomIdSchema, GoalBodySchema } from './mission-objects'

export const GoalProposeParams = z.object({ missionId: AxiomIdSchema, goal: GoalBodySchema })
export const GoalActivateParams = z.object({
  missionId: AxiomIdSchema,
  goalRevisionId: AxiomIdSchema
})
export const GoalShowParams = GoalActivateParams
