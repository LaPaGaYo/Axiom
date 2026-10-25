import type { Candidate } from '../../../shared/axiom-contract/submission-params'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'

export type AttemptBaseline =
  | {
      kind: 'integration'
      reason:
        | 'first_attempt'
        | 'previous_attempt_not_submitted'
        | 'previous_candidate_superseded'
        | 'previous_verification_not_failed'
    }
  | { kind: 'integration'; reason: 'secret_detected'; verificationRun: VerificationRun }
  | {
      kind: 'candidate'
      previousSeq: number
      candidate: Candidate
      verificationRun: VerificationRun
    }

export function previousAttemptSubmission(
  store: AxiomStore,
  { taskId, seq }: { taskId: string; seq: number }
) {
  const previous = seq > 1 ? store.getAttemptBinding(taskId, seq - 1) : undefined
  return previous?.dispatchId ? store.getSubmissionByDispatch(previous.dispatchId) : undefined
}

/** D64: only the immediately preceding submitted Attempt can supply a fix tree. */
export function resolveAttemptBaseline(
  store: AxiomStore,
  input: { taskId: string; seq: number }
): AttemptBaseline {
  if (input.seq === 1) {
    return { kind: 'integration', reason: 'first_attempt' }
  }
  const submission = previousAttemptSubmission(store, input)
  if (!submission) {
    return { kind: 'integration', reason: 'previous_attempt_not_submitted' }
  }
  const candidate = store.getCandidate(submission.candidateId)
  if (candidate?.status !== 'ACTIVE') {
    return { kind: 'integration', reason: 'previous_candidate_superseded' }
  }
  // The store orders by created_at, id; do not filter by FAIL before selecting the latest run.
  const verificationRun = store
    .listVerificationRuns({ missionId: candidate.missionId, candidateId: candidate.id })
    .at(-1)
  if (verificationRun?.status !== 'FAIL') {
    return { kind: 'integration', reason: 'previous_verification_not_failed' }
  }
  if (verificationRun.verdictDetail.reason === 'secret_detected') {
    return { kind: 'integration', reason: 'secret_detected', verificationRun }
  }
  return { kind: 'candidate', previousSeq: input.seq - 1, candidate, verificationRun }
}
