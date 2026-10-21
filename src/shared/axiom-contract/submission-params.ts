import { z } from 'zod'
import { AxiomIdSchema } from './mission-objects'
import { CandidateStatusSchema } from './lifecycle'

const Text = z.string().trim().min(1)
export const SubmissionReportSchema = z.strictObject({
  summary: Text.max(4000),
  filesChanged: z.array(Text),
  checksRun: z.array(
    z.strictObject({
      command: Text,
      result: z.enum(['pass', 'fail', 'skipped']),
      durationMs: z.number().int().nonnegative().optional(),
      note: Text.optional()
    })
  ),
  artifacts: z.array(AxiomIdSchema),
  limitations: z.array(Text),
  risks: z.array(Text),
  questions: z.array(Text),
  followUps: z.array(Text)
})
export type SubmissionReport = z.infer<typeof SubmissionReportSchema>
// Accept both Git object formats; no newer Git command is needed to read either.
export const GitObjectIdSchema = z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/)
export const CandidateSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  attemptId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  commitSha: GitObjectIdSchema,
  treeSha: GitObjectIdSchema,
  status: CandidateStatusSchema,
  supersededBy: AxiomIdSchema.nullable(),
  createdAt: Text,
  updatedAt: Text
})
export type Candidate = z.infer<typeof CandidateSchema>
export const SubmissionSchema = z.object({
  id: AxiomIdSchema,
  missionId: AxiomIdSchema,
  attemptId: AxiomIdSchema,
  taskId: AxiomIdSchema,
  candidateId: AxiomIdSchema,
  report: SubmissionReportSchema,
  checksRun: SubmissionReportSchema.shape.checksRun,
  limitations: SubmissionReportSchema.shape.limitations,
  followUps: SubmissionReportSchema.shape.followUps,
  createdAt: Text
})
