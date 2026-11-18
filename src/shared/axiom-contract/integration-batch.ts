import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { GitObjectIdSchema } from './submission-params'

export const INTEGRATION_BATCH_STATUSES = [
  'QUEUED',
  'APPLYING',
  'TESTING',
  'PROMOTABLE',
  'PROMOTED',
  'CONFLICT',
  'FAILED',
  'AWAITING_APPROVAL',
  'REJECTED',
  'SUPERSEDED'
] as const
export const IntegrationBatchStatusSchema = z.enum(INTEGRATION_BATCH_STATUSES)
export type IntegrationBatchStatus = z.infer<typeof IntegrationBatchStatusSchema>

export const INTEGRATION_BATCH_TRANSITIONS: Record<
  IntegrationBatchStatus,
  readonly IntegrationBatchStatus[]
> = {
  QUEUED: ['APPLYING', 'SUPERSEDED'],
  APPLYING: ['TESTING', 'CONFLICT', 'QUEUED', 'SUPERSEDED'],
  TESTING: ['PROMOTABLE', 'FAILED', 'QUEUED', 'SUPERSEDED'],
  PROMOTABLE: ['PROMOTED', 'AWAITING_APPROVAL', 'SUPERSEDED'],
  AWAITING_APPROVAL: ['PROMOTED', 'REJECTED', 'SUPERSEDED'],
  PROMOTED: [],
  CONFLICT: [],
  FAILED: [],
  REJECTED: [],
  SUPERSEDED: []
}
export const TERMINAL_INTEGRATION_BATCH_STATUSES: ReadonlySet<IntegrationBatchStatus> = new Set([
  'PROMOTED',
  'CONFLICT',
  'FAILED',
  'REJECTED',
  'SUPERSEDED'
])

export function isLegalIntegrationBatchTransition(
  from: IntegrationBatchStatus,
  to: IntegrationBatchStatus
): boolean {
  return INTEGRATION_BATCH_TRANSITIONS[from].includes(to)
}

export const IntegrationBatchSchema = z.strictObject({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  baseCommit: GitObjectIdSchema,
  candidateIds: z.array(AxiomIdSchema).length(1),
  status: IntegrationBatchStatusSchema,
  mergeCommit: GitObjectIdSchema.nullable(),
  conflicts: z.array(z.string().min(1)),
  approvalId: AxiomIdSchema.nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})
export type IntegrationBatch = z.infer<typeof IntegrationBatchSchema>

export const TaskIntegrationSchema = z.object({
  batchId: AxiomIdSchema,
  candidateId: AxiomIdSchema,
  status: IntegrationBatchStatusSchema,
  baseCommit: GitObjectIdSchema,
  mergeCommit: GitObjectIdSchema.nullable(),
  conflicts: z.array(z.string().min(1)),
  updatedAt: z.string().min(1)
})
export type TaskIntegration = z.infer<typeof TaskIntegrationSchema>

export const MissionIntegrationSchema = z.object({
  branch: z.string().min(1),
  recordedHead: GitObjectIdSchema
})
export type MissionIntegration = z.infer<typeof MissionIntegrationSchema>
