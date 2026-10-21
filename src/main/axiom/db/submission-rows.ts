import { z } from 'zod'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import {
  CandidateSchema,
  SubmissionSchema,
  SubmissionReportSchema
} from '../../../shared/axiom-contract/submission-params'
import { VerificationRunStatusSchema } from '../../../shared/axiom-contract/lifecycle'
import { VerificationRunSchema } from '../../../shared/axiom-contract/verification-params'
export { VerificationRunSchema } from '../../../shared/axiom-contract/verification-params'
import { readJson } from './row-codec'

const identity = {
  id: AxiomIdSchema,
  mission_id: AxiomIdSchema,
  task_id: AxiomIdSchema,
  created_at: z.string().min(1)
}
export const CandidateRowSchema = z.object({
  ...identity,
  dispatch_id: AxiomIdSchema,
  commit_sha: CandidateSchema.shape.commitSha,
  tree_sha: CandidateSchema.shape.treeSha,
  status: CandidateSchema.shape.status,
  superseded_by: AxiomIdSchema.nullable(),
  updated_at: z.string().min(1)
})
export const CandidateRowCodec = CandidateRowSchema.transform((r) =>
  CandidateSchema.parse({
    id: r.id,
    missionId: r.mission_id,
    taskId: r.task_id,
    attemptId: r.dispatch_id,
    commitSha: r.commit_sha,
    treeSha: r.tree_sha,
    status: r.status,
    supersededBy: r.superseded_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  })
)
export const SubmissionRowSchema = z.object({
  ...identity,
  dispatch_id: AxiomIdSchema,
  candidate_id: AxiomIdSchema,
  report: z.string(),
  checks_run: z.string(),
  limitations: z.string(),
  follow_ups: z.string()
})
export const SubmissionRowCodec = SubmissionRowSchema.transform((r) =>
  SubmissionSchema.parse({
    id: r.id,
    missionId: r.mission_id,
    taskId: r.task_id,
    attemptId: r.dispatch_id,
    candidateId: r.candidate_id,
    createdAt: r.created_at,
    report: readJson(SubmissionReportSchema, r.report, 'submissions', r.id, 'report'),
    checksRun: readJson(
      SubmissionReportSchema.shape.checksRun,
      r.checks_run,
      'submissions',
      r.id,
      'checks_run'
    ),
    limitations: readJson(
      SubmissionReportSchema.shape.limitations,
      r.limitations,
      'submissions',
      r.id,
      'limitations'
    ),
    followUps: readJson(
      SubmissionReportSchema.shape.followUps,
      r.follow_ups,
      'submissions',
      r.id,
      'follow_ups'
    )
  })
)
export const VerificationRunRowSchema = z.object({
  ...identity,
  candidate_id: AxiomIdSchema,
  status: VerificationRunStatusSchema,
  verdict_detail: z.string(),
  commands: z.string(),
  tool_versions: z.string(),
  verifier: z.string().min(1),
  runtime_epoch: VerificationRunSchema.shape.runtimeEpoch,
  claim_count: VerificationRunSchema.shape.claimCount,
  worktree_id: VerificationRunSchema.shape.worktreeId,
  started_at: VerificationRunSchema.shape.startedAt,
  finished_at: VerificationRunSchema.shape.finishedAt,
  updated_at: z.string().min(1)
})
export const VerificationRunRowCodec = VerificationRunRowSchema.transform((r) =>
  VerificationRunSchema.parse({
    id: r.id,
    missionId: r.mission_id,
    taskId: r.task_id,
    candidateId: r.candidate_id,
    status: r.status,
    verifier: r.verifier,
    runtimeEpoch: r.runtime_epoch,
    claimCount: r.claim_count,
    worktreeId: r.worktree_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    verdictDetail: readJson(
      VerificationRunSchema.shape.verdictDetail,
      r.verdict_detail,
      'verification_runs',
      r.id,
      'verdict_detail'
    ),
    commands: readJson(
      VerificationRunSchema.shape.commands,
      r.commands,
      'verification_runs',
      r.id,
      'commands'
    ),
    toolVersions: readJson(
      VerificationRunSchema.shape.toolVersions,
      r.tool_versions,
      'verification_runs',
      r.id,
      'tool_versions'
    )
  })
)
