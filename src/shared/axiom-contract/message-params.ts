import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'

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
export const MessageRelatedSchema = z
  .object({
    taskIds: z.array(AxiomIdSchema).optional(),
    decisionId: AxiomIdSchema.optional(),
    artifactId: AxiomIdSchema.optional()
  })
  .strict()
export const SubtaskRequestSchema = z
  .object({
    title: z.string().trim().min(1),
    objective: z.string().trim().min(1),
    allowedPaths: z.array(z.string().min(1)).min(1),
    acceptanceCriteria: z.array(z.string().min(1)).min(1),
    requiredEvidence: z.array(z.string().min(1)).min(1),
    risk: z.enum(['low', 'medium', 'high'])
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
    subtask: SubtaskRequestSchema.optional()
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
  })
export const AxiomMessagePayloadSchema = z.object({ axiom: MessageFieldsSchema }).strict()
export type AxiomMessagePayload = z.infer<typeof AxiomMessagePayloadSchema>

/** Persisted mail may be plain Orca mail or malformed older payloads. */
export function parseAxiomMessagePayload(payload: string | null): AxiomMessagePayload | undefined {
  if (!payload) {
    return undefined
  }
  try {
    const parsed = AxiomMessagePayloadSchema.safeParse(JSON.parse(payload))
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
  createdAt: z.string(),
  pending: z.boolean()
})
export const MessageListResponseSchema = z.object({
  messages: z.array(MessageSummaryResponseSchema)
})
export const AttemptMessageResponseSchema = z.object({
  message: MessageSummaryResponseSchema,
  recipients: z.array(z.string())
})
