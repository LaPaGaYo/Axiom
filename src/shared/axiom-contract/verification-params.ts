import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { VerificationRunStatusSchema } from './lifecycle'
import { GitObjectIdSchema } from './submission-params'

export const VerificationResolveParams = z.strictObject({
  runId: AxiomIdSchema,
  verdict: z.enum(['PASS', 'FAIL']),
  rationale: z.string().trim().min(1).max(4000),
  criteria: z.array(z.number().int().nonnegative()).max(50).default([])
})
export const VerificationRerunParams = z.strictObject({
  taskId: AxiomIdSchema,
  rationale: z.string().trim().min(1).max(4000)
})

export const VerificationResolutionSchema = VerificationResolveParams.omit({ runId: true }).extend({
  by: z.literal('user'),
  at: z.string().min(1)
})
export const VerificationRerunDetailSchema = VerificationRerunParams.omit({ taskId: true }).extend({
  by: z.literal('user'),
  at: z.string().min(1)
})

export const VerificationRunSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  candidateId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  status: VerificationRunStatusSchema,
  verdictDetail: z.record(z.string(), z.unknown()),
  commands: z.array(z.string()),
  toolVersions: z.record(z.string(), z.string()),
  verifier: z.string().min(1),
  runtimeEpoch: z.string().min(1).nullable(),
  claimCount: z.number().int().nonnegative(),
  worktreeId: z.string().min(1).nullable(),
  startedAt: z.string().min(1).nullable(),
  finishedAt: z.string().min(1).nullable(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1)
})
export type VerificationRun = z.infer<typeof VerificationRunSchema>
export const VerificationShowParams = z.object({ runId: AxiomIdSchema })
export const VerificationListParams = z.object({
  missionId: AxiomIdSchema,
  taskId: AxiomIdSchema.optional(),
  candidateId: AxiomIdSchema.optional(),
  status: VerificationRunStatusSchema.optional()
})
export const VerificationRunViewSchema = VerificationRunSchema.extend({
  candidateCommitSha: GitObjectIdSchema,
  candidateTreeSha: GitObjectIdSchema,
  phase: z.string().nullable()
})
export type VerificationRunView = z.infer<typeof VerificationRunViewSchema>
export const VerificationResponseSchema = z.object({ run: VerificationRunViewSchema })
export const VerificationListResponseSchema = z.object({ runs: z.array(VerificationRunViewSchema) })
export type VerificationResponse = z.infer<typeof VerificationResponseSchema>
export type VerificationListResponse = z.infer<typeof VerificationListResponseSchema>
