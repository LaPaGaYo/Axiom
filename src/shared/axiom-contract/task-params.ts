import { z } from 'zod'
import { requiredString } from '../rpc-contract/rpc-param-primitives'
import { TaskStageSchema } from './lifecycle'
import { AxiomIdSchema, ProvenanceSchema, TaskSpecSchema } from './mission-objects'

export const TaskListParams = z.object({
  missionId: AxiomIdSchema,
  stage: TaskStageSchema.optional()
})
export const TaskShowParams = z.object({ taskId: AxiomIdSchema })
export const TaskCancelParams = TaskShowParams.extend({
  rationale: requiredString('Missing rationale')
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
  previousStage: TaskStageSchema.optional()
})
export type TaskListItem = z.infer<typeof TaskListItemSchema>

export const TaskResponseSchema = z.object({ task: TaskListItemSchema })
export const TaskListResponseSchema = z.object({ tasks: z.array(TaskListItemSchema) })
export type TaskResponse = z.infer<typeof TaskResponseSchema>
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>
