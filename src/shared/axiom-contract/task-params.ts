import { z } from 'zod'
import { requiredString } from '../rpc-contract/rpc-param-primitives'
import { TaskStageSchema } from './lifecycle'
import { TaskWaitingOnSchema } from './task-waiting-on'
import {
  AcceptanceCriterionSchema,
  AxiomIdSchema,
  ProvenanceSchema,
  TaskSpecSchema
} from './mission-objects'

export const TaskListParams = z.object({
  missionId: AxiomIdSchema,
  stage: TaskStageSchema.optional()
})
export const TaskShowParams = z.object({ taskId: AxiomIdSchema })
export const TaskCancelParams = TaskShowParams.extend({
  rationale: requiredString('Missing rationale')
})
export const TaskAdjustParams = z.strictObject({
  taskId: AxiomIdSchema,
  rationale: requiredString('Missing rationale'),
  addAllowedPaths: z.array(z.string().trim().min(1)).max(50).default([]),
  maxAttempts: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  acceptanceCriteria: z.array(AcceptanceCriterionSchema).max(50).optional()
})
export const TaskCreateParams = z.strictObject({
  missionId: AxiomIdSchema,
  task: TaskSpecSchema.omit({ id: true }),
  dependsOn: z.array(AxiomIdSchema).default([]),
  // D50 model provenance is audit evidence; it does not change PlanRevision provenance.
  provenance: ProvenanceSchema.extend({
    kind: z.enum(['user', 'planner', 'control_plane', 'model'])
  })
})

export const TaskListItemSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  planRevisionId: AxiomIdSchema,
  title: requiredString('Missing title'),
  stage: TaskStageSchema,
  // Glossary §4.5: execution projection only. `completed` is not product completion.
  orcaStatus: z.enum(['pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked']),
  previousStage: TaskStageSchema.optional(),
  waitingOn: TaskWaitingOnSchema.optional()
})
export type TaskListItem = z.infer<typeof TaskListItemSchema>

export const TaskResponseSchema = z.object({
  task: TaskListItemSchema.extend({ spec: TaskSpecSchema.optional() })
})
export const TaskListResponseSchema = z.object({ tasks: z.array(TaskListItemSchema) })
export type TaskResponse = z.infer<typeof TaskResponseSchema>
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>
