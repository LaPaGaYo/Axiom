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
  questions: z.array(Text.max(2000)).max(20).default([]),
  followUps: z.array(Text.max(2000)).max(20).default([])
})
export type SubmissionReport = z.infer<typeof SubmissionReportSchema>
// Read compatibility: reports persisted before M3-04b-3 had no item-count/text caps.
// New submissions must continue to use SubmissionReportSchema at the write boundary.
export const StoredSubmissionReportSchema = SubmissionReportSchema.extend({
  questions: z.array(Text).default([]),
  followUps: z.array(Text).default([])
})
export const HeadlessOutcomeSchema = z.discriminatedUnion('outcome', [
  z
    .strictObject({ outcome: z.literal('submitted') })
    .describe('The worktree contains the change for independent verification.'),
  z
    .strictObject({
      outcome: z.literal('no_change'),
      reason: z.enum(['candidate_already_correct', 'cannot_reproduce'])
    })
    .describe(
      'No change: the Candidate is already correct or the failure cannot be reproduced; explain in summary.'
    ),
  z
    .strictObject({
      outcome: z.literal('blocked'),
      reason: z.literal('blocked_by_scope'),
      paths: z.array(Text.max(500)).min(1).max(50)
    })
    .describe(
      'Blocked: the fix requires the named paths outside allowedPaths; stop without editing them.'
    )
])
export type HeadlessOutcome = z.infer<typeof HeadlessOutcomeSchema>
// Paths are Worker claims; the host confines, reads and attributes them before submission.
export const HeadlessSubmissionReportSchema = SubmissionReportSchema.omit({
  filesChanged: true
}).extend({
  outcome: HeadlessOutcomeSchema.optional().describe('Absent means submitted.'),
  artifacts: z.array(
    z.strictObject({
      path: Text,
      kind: z.enum(['worker_report', 'handoff', 'evidence', 'log', 'other']),
      mediaType: Text
    })
  )
})
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
  report: StoredSubmissionReportSchema,
  checksRun: SubmissionReportSchema.shape.checksRun,
  limitations: SubmissionReportSchema.shape.limitations,
  followUps: StoredSubmissionReportSchema.shape.followUps,
  createdAt: Text
})
