import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { AttemptStateSchema, type AttemptState } from './lifecycle'
import { MessageRelatedSchema, MessageSummarySchema, SubtaskRequestSchema } from './message-params'
import { CandidateSchema, SubmissionSchema, SubmissionReportSchema } from './submission-params'

const AttemptSenderFields = {
  attemptId: AxiomIdSchema,
  from: z.string().min(1),
  senderPaneKey: z.string().min(1).optional()
}
export const AttemptSubmitParams = z.strictObject({
  ...AttemptSenderFields,
  report: SubmissionReportSchema
})
export const AttemptSubmitResponseSchema = z.object({
  submission: SubmissionSchema,
  candidate: CandidateSchema,
  duplicate: z.boolean()
})
export const AttemptMessageParams = z
  .object({
    ...AttemptSenderFields,
    summary: MessageSummarySchema,
    body: z.string().max(2000).optional(),
    artifactIds: z.array(AxiomIdSchema).default([]),
    related: MessageRelatedSchema.default({})
  })
  .strict()
export const AttemptInformParams = AttemptMessageParams
export const AttemptRequestParams = AttemptMessageParams
export const AttemptBlockedParams = AttemptMessageParams
export const AttemptHandoffParams = AttemptMessageParams
export const AttemptRequestSubtaskParams = AttemptMessageParams.extend({
  subtask: SubtaskRequestSchema
})
export const AttemptAskParams = z
  .strictObject({
    ...AttemptSenderFields,
    question: MessageSummarySchema.optional(),
    options: z.array(z.string().trim().min(1)).optional(),
    timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
    resume: AxiomIdSchema.optional()
  })
  .refine(
    (p) => p.resume !== undefined || p.question !== undefined,
    'Question or resume is required'
  )
export const AttemptAskResponseSchema = z.object({
  answer: z.string().nullable(),
  messageId: AxiomIdSchema,
  answerMessageId: AxiomIdSchema.nullable().optional(),
  threadId: AxiomIdSchema,
  timedOut: z.boolean(),
  cancelled: z.boolean(),
  connectionLost: z.boolean(),
  timeoutMs: z.number()
})
export const AttemptCheckParams = z
  .object({
    ...AttemptSenderFields,
    wait: z.boolean().optional(),
    timeoutMs: z.number().int().nonnegative().max(2147483647).optional(),
    type: z.string().min(1).optional()
  })
  .strict()
// The kernel owns delivery ids, generation fencing and the wire message projection.
export const AttemptCheckResponseSchema = z.object({
  runId: z.string(),
  dispatchId: z.string(),
  messages: z.array(
    z.object({ id: z.string(), type: z.string(), payload: z.string().nullable() }).passthrough()
  ),
  count: z.number().int().nonnegative(),
  deliveryId: z.string().nullable().optional(),
  acknowledged: z.string().nullable(),
  replayed: z.boolean().optional(),
  timedOut: z.boolean().optional(),
  cancelled: z.boolean().optional(),
  connectionLost: z.boolean().optional()
})

export const AttemptShowParams = z.object({ attemptId: AxiomIdSchema })
export const AttemptListParams = z.object({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema.optional()
})
export const AttemptSummarySchema = z.object({
  attemptId: AxiomIdSchema.nullable(),
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  branch: z.string().min(1),
  agentSpecId: AxiomIdSchema,
  contextPackageId: AxiomIdSchema,
  provider: z.string().nullable(),
  state: AttemptStateSchema,
  liveness: z.enum(['live', 'unverifiable', 'exited']).nullable(),
  livenessReason: z.string().nullable().optional(),
  workspace: z.enum(['retained', 'released', 'pending']).nullable(),
  worktreeId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
})
export type AttemptSummary = z.infer<typeof AttemptSummarySchema>
export const AttemptResponseSchema = z.object({ attempt: AttemptSummarySchema })
export const AttemptListResponseSchema = z.object({ attempts: z.array(AttemptSummarySchema) })
const workerStates: Readonly<Record<string, AttemptState>> = {
  starting: 'STARTING',
  ready: 'RUNNING',
  stopping: 'RUNNING',
  succeeded: 'SUBMITTED',
  failed: 'FAILED',
  stopped: 'STOPPED',
  abandoned: 'ABANDONED',
  start_unknown: 'START_UNKNOWN',
  stop_unknown: 'STOP_UNKNOWN'
}
export function projectAttemptState(stage: { worker: string; dispatch: string }): AttemptState {
  return stage.dispatch === 'circuit_broken'
    ? 'FAILED'
    : (workerStates[stage.worker] ?? 'START_UNKNOWN')
}
