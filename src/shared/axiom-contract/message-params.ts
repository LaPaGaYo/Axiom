import { z } from 'zod'
import { AcceptanceCriterionSchema, AxiomIdSchema } from './mission-objects'
import { resolvePersistedMessageAcceptance } from './persisted-message-acceptance'

export const AXIOM_MESSAGE_TYPES = [
  'INFORM',
  'REQUEST',
  'QUESTION',
  'DECISION',
  'BLOCKED',
  'HANDOFF',
  'REQUEST_SUBTASK',
  'SUBMISSION'
] as const
export const AxiomMessageTypeSchema = z.enum(AXIOM_MESSAGE_TYPES)
export type AxiomMessageType = z.infer<typeof AxiomMessageTypeSchema>
const routingTypes = {
  INFORM: 'status',
  REQUEST: 'escalation',
  QUESTION: 'question',
  DECISION: 'status',
  BLOCKED: 'escalation',
  HANDOFF: 'handoff',
  REQUEST_SUBTASK: 'escalation',
  SUBMISSION: 'worker_done'
} as const
export function axiomMessageRoutingType(type: AxiomMessageType) {
  return routingTypes[type]
}

export const MessageSummarySchema = z.string().trim().min(1).max(2000)
const Text = z.string().trim().min(1)
const QuestionMessageSchema = z.strictObject({
  text: Text.max(2000),
  options: z.array(Text.max(200)).max(8).default([])
})
const FollowUpMessageSchema = z.strictObject({ text: Text.max(2000) })
export const WorkerBlockedMessageSchema = z.strictObject({
  reason: z.enum(['blocked_by_scope', 'candidate_already_correct', 'cannot_reproduce']),
  paths: z.array(z.string().trim().min(1)).max(50).default([])
})
export const BlockedMessageSchema = WorkerBlockedMessageSchema.extend({
  reason: WorkerBlockedMessageSchema.shape.reason.or(z.literal('environment'))
})
export const MessageRelatedSchema = z
  .object({
    taskIds: z.array(AxiomIdSchema).optional(),
    decisionId: AxiomIdSchema.optional(),
    artifactId: AxiomIdSchema.optional(),
    submissionId: AxiomIdSchema.optional()
  })
  .strict()
export const SubtaskRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    acceptanceCriteria: z.array(AcceptanceCriterionSchema),
    risk: z.enum(['low', 'medium', 'high']).default('low'),
    dependsOn: z.array(AxiomIdSchema).optional()
  })
  .strict()
const MessageFieldsSchema = z
  .object({
    version: z.literal(1),
    type: AxiomMessageTypeSchema,
    missionId: AxiomIdSchema,
    taskId: AxiomIdSchema,
    attemptId: AxiomIdSchema,
    summary: MessageSummarySchema,
    artifactIds: z.array(AxiomIdSchema),
    related: MessageRelatedSchema,
    subtask: SubtaskRequestSchema.optional(),
    blocked: BlockedMessageSchema.optional(),
    question: QuestionMessageSchema.optional(),
    followUp: FollowUpMessageSchema.optional()
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.type === 'REQUEST_SUBTASK') !== (p.subtask !== undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: ['subtask'],
        message: 'subtask is required only for REQUEST_SUBTASK.'
      })
    }
    if (p.blocked !== undefined && p.type !== 'BLOCKED') {
      ctx.addIssue({
        code: 'custom',
        path: ['blocked'],
        message: 'blocked is only allowed for BLOCKED.'
      })
    }
    if (p.question !== undefined && p.type !== 'QUESTION') {
      ctx.addIssue({
        code: 'custom',
        path: ['question'],
        message: 'question is only allowed for QUESTION.'
      })
    }
    if (p.followUp !== undefined && p.type !== 'REQUEST') {
      ctx.addIssue({
        code: 'custom',
        path: ['followUp'],
        message: 'followUp is only allowed for REQUEST.'
      })
    }
  })
export const AxiomMessagePayloadSchema = z.object({ axiom: MessageFieldsSchema }).strict()
export type AxiomMessagePayload = z.infer<typeof AxiomMessagePayloadSchema>

/** Persisted mail may be plain Orca mail or malformed older payloads. */
export function parseAxiomMessagePayload(payload: string | null): AxiomMessagePayload | undefined {
  if (!payload) {
    return undefined
  }
  try {
    const parsed = AxiomMessagePayloadSchema.safeParse(
      resolvePersistedMessageAcceptance(JSON.parse(payload))
    )
    return parsed.success ? parsed.data : undefined
  } catch {
    return undefined
  }
}

export const MessageListParams = z
  .object({
    missionId: AxiomIdSchema,
    type: AxiomMessageTypeSchema.optional(),
    taskId: AxiomIdSchema.optional(),
    attemptId: AxiomIdSchema.optional(),
    pendingOnly: z.boolean().optional()
  })
  .strict()
export const MessageSummaryResponseSchema = z.object({
  id: AxiomIdSchema,
  type: AxiomMessageTypeSchema,
  taskId: AxiomIdSchema,
  attemptId: AxiomIdSchema,
  summary: MessageSummarySchema,
  artifactIds: z.array(AxiomIdSchema),
  related: MessageRelatedSchema,
  subtask: SubtaskRequestSchema.optional(),
  blocked: BlockedMessageSchema.optional(),
  followUp: FollowUpMessageSchema.optional(),
  createdAt: z.string(),
  pending: z.boolean(),
  question: z.string().optional(),
  options: z.array(z.string()).optional(),
  answer: z.string().nullable().optional(),
  status: z.enum(['pending', 'answered', 'closed']).optional()
})
export const MessageAnswerParams = z.strictObject({
  missionId: AxiomIdSchema,
  questionId: AxiomIdSchema,
  body: z.string().min(1)
})
export const MessageResolveParams = z.strictObject({
  missionId: AxiomIdSchema,
  messageId: AxiomIdSchema,
  decision: z.enum(['accept', 'reject']),
  rationale: MessageSummarySchema
})
export const MessageListResponseSchema = z.object({
  messages: z.array(MessageSummaryResponseSchema)
})
export const AttemptMessageResponseSchema = z.object({
  message: MessageSummaryResponseSchema,
  recipients: z.array(z.string())
})
