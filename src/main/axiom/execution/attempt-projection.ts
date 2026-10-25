import {
  AttemptSummarySchema,
  projectAttemptState
} from '../../../shared/axiom-contract/attempt-params'
import type { OrchestrationFleetWorker } from '../../../shared/orchestration-fleet-projection'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import type { AxiomStore } from '../db/axiom-store'

export function findSubmissionTranscriptArtifactId(
  store: AxiomStore,
  missionId: string,
  submissionId: string
) {
  return store
    .listArtifacts({ missionId, kind: 'log', relatedTo: submissionId })
    .findLast((artifact) => artifact.createdBy === 'AttemptSettlement')?.id
}

export function foldAttemptLiveness(
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>
) {
  return observation.status === 'live' || observation.status === 'exited'
    ? observation.status
    : 'unverifiable'
}

export async function projectAttempt(
  store: AxiomStore,
  binding: NonNullable<ReturnType<AxiomStore['getAttemptBinding']>>,
  projectFleetWorker: (dispatchId: string) => OrchestrationFleetWorker | null,
  inspectTerminal: (dispatchId: string) => ReturnType<typeof inspectWorkerTerminal>
) {
  const worker = binding.dispatchId === null ? null : projectFleetWorker(binding.dispatchId)
  const observation = binding.dispatchId === null ? null : await inspectTerminal(binding.dispatchId)
  const liveness = observation ? foldAttemptLiveness(observation) : null
  const release = worker?.resource.state === 'absent' ? null : worker?.resource.releaseState
  const spec = store.getAgentSpec(binding.agentSpecId)?.spec
  const submission = binding.dispatchId
    ? store.getSubmissionByDispatch(binding.dispatchId)
    : undefined
  const candidate = submission ? store.getCandidate(submission.candidateId) : undefined
  if (submission && !candidate) {
    throw new Error('Submission Candidate is missing')
  }
  const transcriptArtifactId = submission
    ? findSubmissionTranscriptArtifactId(store, binding.missionId, submission.id)
    : undefined
  return AttemptSummarySchema.parse({
    ...binding,
    attemptId: binding.dispatchId,
    role: spec?.role ?? 'worker',
    provider: spec?.provider ?? worker?.provider?.id ?? null,
    submission:
      submission && candidate
        ? {
            id: submission.id,
            ...(transcriptArtifactId ? { transcriptArtifactId } : {}),
            candidateId: candidate.id,
            commitSha: candidate.commitSha,
            treeSha: candidate.treeSha,
            filesChanged: submission.report.filesChanged,
            checksRun: submission.report.checksRun,
            limitations: submission.report.limitations,
            risks: submission.report.risks,
            followUps: submission.report.followUps,
            createdAt: submission.createdAt
          }
        : undefined,
    state:
      binding.dispatchId === null
        ? 'LAUNCH_PENDING'
        : worker
          ? projectAttemptState(worker.stage)
          : 'START_UNKNOWN',
    liveness,
    livenessReason:
      observation?.reason ?? (liveness === 'unverifiable' ? observation?.status : null),
    workspace:
      release == null
        ? null
        : release === 'retained' || release === 'released'
          ? release
          : 'pending',
    worktreeId: worker?.workspace?.id ?? null
  })
}
