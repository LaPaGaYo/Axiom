import { z } from 'zod'
import { OptionalString, requiredString } from '../rpc-contract/rpc-param-primitives'
import { RepoSelector } from '../rpc-contract/github-repo-target-params'
import { MissionStatusSchema } from './lifecycle'
import {
  AxiomIdSchema,
  GoalBodySchema,
  GoalRevisionSchema,
  MissionSchema,
  PolicySchema
} from './mission-objects'

export const MissionCreateParams = RepoSelector.extend({
  targetBranch: requiredString('Missing targetBranch'),
  goal: GoalBodySchema,
  policy: PolicySchema
})
export const MissionShowParams = z.object({ missionId: AxiomIdSchema })
export const MissionStartParams = MissionShowParams
export const MissionPlanParams = MissionShowParams
export const MissionPlanResponseSchema = z.object({
  attempt: z.object({
    attemptId: AxiomIdSchema.nullable(),
    seq: z.number().int().positive(),
    branch: z.string().min(1),
    worktreeId: z.string().nullable(),
    provider: z.string().min(1)
  })
})
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
  runId: true,
  repoId: true,
  repoPath: true,
  targetBranch: true,
  status: true,
  activeGoalRevisionId: true,
  activePlanRevisionId: true
}).extend({ reason: z.string().optional() })
export type MissionSummary = z.infer<typeof MissionSummarySchema>

export const MissionResponseSchema = z.object({ mission: MissionSummarySchema })
export const AttemptReconcileEntrySchema = z.object({
  attemptId: AxiomIdSchema.nullable(),
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  liveness: z.enum(['live', 'exited', 'unverifiable']).nullable(),
  action: z.string().min(1)
})
export type AttemptReconcileEntry = z.infer<typeof AttemptReconcileEntrySchema>
export const MissionCancelResponseSchema = MissionResponseSchema.extend({
  attempts: z.array(AttemptReconcileEntrySchema).optional()
})
export const MissionCreateResponseSchema = MissionResponseSchema.extend({
  goalRevision: GoalRevisionSchema,
  policy: PolicySchema
})
export const MissionListResponseSchema = z.object({ missions: z.array(MissionSummarySchema) })
export type MissionResponse = z.infer<typeof MissionResponseSchema>
export type MissionCreateResponse = z.infer<typeof MissionCreateResponseSchema>
export type MissionListResponse = z.infer<typeof MissionListResponseSchema>
