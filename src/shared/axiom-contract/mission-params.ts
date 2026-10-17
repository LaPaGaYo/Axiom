import { z } from 'zod'
import { OptionalString, requiredString } from '../rpc-contract/rpc-param-primitives'
import { RepoSelector } from '../rpc-contract/github-repo-target-params'
import { MissionStatusSchema } from './lifecycle'
import { AxiomIdSchema, GoalBodySchema, MissionSchema, PolicySchema } from './mission-objects'

export const MissionCreateParams = RepoSelector.extend({
  targetBranch: requiredString('Missing targetBranch'),
  goal: GoalBodySchema,
  policy: PolicySchema
})
export const MissionShowParams = z.object({ missionId: AxiomIdSchema })
export const MissionListParams = z.object({
  repo: OptionalString,
  status: MissionStatusSchema.optional(),
  cursor: AxiomIdSchema.optional()
})
export const MissionPauseParams = MissionShowParams.extend({
  reason: requiredString('Missing reason')
})
export const MissionResumeParams = MissionPauseParams
export const MissionCancelParams = MissionPauseParams

export const MissionSummarySchema = MissionSchema.pick({
  id: true,
  repoId: true,
  repoPath: true,
  targetBranch: true,
  status: true,
  activeGoalRevisionId: true,
  activePlanRevisionId: true
})
export type MissionSummary = z.infer<typeof MissionSummarySchema>
