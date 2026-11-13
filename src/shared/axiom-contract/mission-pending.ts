import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { TaskWaitingOnSchema } from './task-waiting-on'

// This order breaks ties after blocking and downstream Task count.
export const PENDING_ITEM_KINDS = [
  'mission',
  'plan_review',
  'question',
  'human_review',
  'task_blocked',
  'subtask_request',
  'follow_up',
  'stall_notice',
  'supervision_proposal'
] as const
export const PendingActionSchema = z.enum([
  'axiom.mission.start',
  'axiom.mission.resume',
  'axiom.mission.plan',
  'axiom.mission.cancel',
  'axiom.plan.approve',
  'axiom.plan.reject',
  'axiom.message.answer',
  'axiom.verification.resolve',
  'axiom.verification.rerun',
  'axiom.task.adjust',
  'axiom.task.cancel',
  'axiom.policy.update',
  'axiom.message.resolve',
  'axiom.supervision.resolve'
])
export const MissionPendingParams = z.strictObject({ missionId: AxiomIdSchema })
export const MissionPendingItemSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum(PENDING_ITEM_KINDS),
  objectId: AxiomIdSchema,
  taskId: AxiomIdSchema.optional(),
  reason: z.string().min(1),
  summary: z.string().optional(),
  blocking: z.boolean(),
  blocks: z.number().int().nonnegative(),
  actions: z.array(PendingActionSchema),
  since: z.iso.datetime(),
  waitingOn: TaskWaitingOnSchema.optional()
})
export const MissionPendingResponseSchema = z.object({
  missionId: AxiomIdSchema,
  items: z.array(MissionPendingItemSchema)
})
export type MissionPendingItem = z.infer<typeof MissionPendingItemSchema>
export type MissionPendingResponse = z.infer<typeof MissionPendingResponseSchema>
export type PendingAction = z.infer<typeof PendingActionSchema>
