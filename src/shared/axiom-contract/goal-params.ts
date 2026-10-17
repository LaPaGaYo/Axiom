import { z } from 'zod'
import { AxiomIdSchema, GoalBodySchema, GoalRevisionSchema } from './mission-objects'

export const GoalProposeParams = z.object({ missionId: AxiomIdSchema, goal: GoalBodySchema })
export const GoalActivateParams = z.object({
  missionId: AxiomIdSchema,
  goalRevisionId: AxiomIdSchema
})
export const GoalShowParams = GoalActivateParams

export const GoalResponseSchema = z.object({ goalRevision: GoalRevisionSchema })
export type GoalResponse = z.infer<typeof GoalResponseSchema>
