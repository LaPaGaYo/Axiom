import type { Candidate } from '../../../shared/axiom-contract/submission-params'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'
import { z } from 'zod'

const UnchangedFailure = z.object({
  settlement: z.object({ kind: z.literal('unchanged') }),
  reportSummary: z.string().nullable().optional()
})
type UnchangedAttempt = { seq: number; attemptId: string; reportSummary: string | null }

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
      unchangedAttempts: UnchangedAttempt[]
    }

export function previousAttemptSubmission(
  store: AxiomStore,
  { taskId, seq }: { taskId: string; seq: number }
) {
  const previous = seq > 1 ? store.getAttemptBinding(taskId, seq - 1) : undefined
  return previous?.dispatchId ? store.getSubmissionByDispatch(previous.dispatchId) : undefined
}

/** D64 / D85: walk only across audited unchanged exits, never arbitrary failures. */
export function resolveAttemptBaseline(
  store: AxiomStore,
  input: { taskId: string; seq: number }
): AttemptBaseline {
  if (input.seq === 1) {
    return { kind: 'integration', reason: 'first_attempt' }
  }
  let previousSeq = input.seq - 1
  let submission = previousAttemptSubmission(store, input)
  const unchangedAttempts: UnchangedAttempt[] = []
  const binding = store.getAttemptBinding(input.taskId, previousSeq)
  const failures = new Map(
    (binding ? store.listAuditEvents({ missionId: binding.missionId }) : [])
      .filter((event) => event.event === 'attempt.failed' && event.objectKind === 'attempt')
      .map((event) => [event.objectId, event.after])
  )
  while (!submission && previousSeq >= 1) {
    const previous = store.getAttemptBinding(input.taskId, previousSeq)
    const failure = UnchangedFailure.safeParse(failures.get(previous?.dispatchId ?? ''))
    if (!previous?.dispatchId || !failure.success) {
      break
    }
    unchangedAttempts.push({
      seq: previousSeq,
      attemptId: previous.dispatchId,
      reportSummary: failure.data.reportSummary ?? null
    })
    previousSeq--
    submission = previousAttemptSubmission(store, { taskId: input.taskId, seq: previousSeq + 1 })
  }
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
  return {
    kind: 'candidate',
    previousSeq,
    candidate,
    verificationRun,
    unchangedAttempts: unchangedAttempts.sort((a, b) => a.seq - b.seq)
  }
}
