import type { Candidate } from '../../../shared/axiom-contract/submission-params'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { AxiomStore } from '../db/axiom-store'
import { z } from 'zod'
import {
  readPreservedBaseline,
  type SnapshotAttemptBaseline,
  type PreservedWorkNotUsed
} from './preserved-baseline'
import {
  AttemptFailureSchema,
  type AttemptFailure
} from '../../../shared/axiom-contract/attempt-failure'

const SkippedFailure = z.object({
  settlement: z.object({
    kind: z.enum(['unchanged', 'no_change', 'blocked', 'interrupted']),
    reason: z
      .enum(['blocked_by_scope', 'candidate_already_correct', 'cannot_reproduce'])
      .optional(),
    paths: z.array(z.string()).max(50).optional()
  }),
  reportSummary: z.string().nullable().optional(),
  failure: AttemptFailureSchema.optional()
})
export type SkippedAttempt = z.infer<typeof SkippedFailure>['settlement'] & {
  seq: number
  attemptId: string
  reportSummary: string | null
  failureClass?: AttemptFailure['class']
}

export type LegacyAttemptBaseline =
  | {
      kind: 'integration'
      reason: 'first_attempt' | 'previous_candidate_superseded' | 'previous_verification_not_failed'
    }
  | {
      kind: 'integration'
      reason: 'previous_attempt_not_submitted'
      skippedAttempts: SkippedAttempt[]
    }
  | { kind: 'integration'; reason: 'secret_detected'; verificationRun: VerificationRun }
  | {
      kind: 'candidate'
      previousSeq: number
      candidate: Candidate
      verificationRun: VerificationRun
      skippedAttempts: SkippedAttempt[]
    }

export type AttemptBaseline = (LegacyAttemptBaseline | SnapshotAttemptBaseline) & {
  notContinued?: PreservedWorkNotUsed[]
}

export function previousAttemptSubmission(
  store: AxiomStore,
  { taskId, seq }: { taskId: string; seq: number }
) {
  const previous = seq > 1 ? store.getAttemptBinding(taskId, seq - 1) : undefined
  return previous?.dispatchId ? store.getSubmissionByDispatch(previous.dispatchId) : undefined
}

/** D64 / D85 / D88: walk across audited unchanged, declared or interrupted exits. */
export function resolveAttemptBaseline(
  store: AxiomStore,
  input: { taskId: string; seq: number }
): AttemptBaseline {
  if (input.seq === 1) {
    return { kind: 'integration', reason: 'first_attempt' }
  }
  let previousSeq = input.seq - 1
  let submission = previousAttemptSubmission(store, input)
  const skippedAttempts: SkippedAttempt[] = []
  const notContinued: PreservedWorkNotUsed[] = []
  const finish = (baseline: LegacyAttemptBaseline | SnapshotAttemptBaseline): AttemptBaseline =>
    notContinued.length ? { ...baseline, notContinued } : baseline
  const binding = store.getAttemptBinding(input.taskId, previousSeq)
  const audits = binding ? store.listAuditEvents({ missionId: binding.missionId }) : []
  const failures = new Map(
    audits
      .filter((event) => event.event === 'attempt.failed' && event.objectKind === 'attempt')
      .map((event) => [event.objectId, event.after])
  )
  const preserved = new Map(
    audits
      .filter((event) => event.event === 'attempt.preserved' && event.objectKind === 'attempt')
      .map((event) => [event.objectId, event.after])
  )
  const stopped = new Map(
    audits
      .filter((event) => event.event === 'attempt.stopped' && event.objectKind === 'attempt')
      .map((event) => [event.objectId, event.after])
  )
  while (!submission && previousSeq >= 1) {
    const previous = store.getAttemptBinding(input.taskId, previousSeq)
    if (previous?.dispatchId && preserved.has(previous.dispatchId)) {
      const evidence = readPreservedBaseline({
        taskId: input.taskId,
        seq: previousSeq,
        attemptId: previous.dispatchId,
        audit: preserved.get(previous.dispatchId),
        failure: failures.get(previous.dispatchId),
        stopped: stopped.get(previous.dispatchId),
        allowedPaths: store.getTaskStage(input.taskId)?.spec.scope.allowedPaths ?? []
      })
      if ('usable' in evidence) {
        // What the continued Attempt itself did not inherit is its history, not this baseline.
        const { notContinued: _below, ...underlying } = resolveAttemptBaseline(store, {
          taskId: input.taskId,
          seq: previousSeq
        })
        return finish({
          ...evidence.usable,
          skippedAttempts,
          underlying: underlying.kind === 'snapshot' ? underlying.underlying : underlying
        })
      }
      notContinued.push(evidence.unused)
      if (evidence.stopWalk) {
        break
      }
    }
    const failure = SkippedFailure.safeParse(failures.get(previous?.dispatchId ?? ''))
    if (!previous?.dispatchId || !failure.success) {
      break
    }
    skippedAttempts.unshift({
      ...failure.data.settlement,
      seq: previousSeq,
      attemptId: previous.dispatchId,
      ...(failure.data.settlement.kind === 'interrupted'
        ? { failureClass: failure.data.failure?.class ?? 'unknown' }
        : {}),
      reportSummary: failure.data.reportSummary ?? null
    })
    previousSeq--
    submission = previousAttemptSubmission(store, { taskId: input.taskId, seq: previousSeq + 1 })
  }
  if (!submission) {
    return finish({
      kind: 'integration',
      reason: 'previous_attempt_not_submitted',
      skippedAttempts
    })
  }
  const candidate = store.getCandidate(submission.candidateId)
  if (candidate?.status !== 'ACTIVE') {
    return finish({ kind: 'integration', reason: 'previous_candidate_superseded' })
  }
  // The store preserves insertion order for same-second reruns; select latest before filtering FAIL.
  const verificationRun = store
    .listVerificationRuns({ missionId: candidate.missionId, candidateId: candidate.id })
    .at(-1)
  if (verificationRun?.status !== 'FAIL') {
    return finish({ kind: 'integration', reason: 'previous_verification_not_failed' })
  }
  if (verificationRun.verdictDetail.reason === 'secret_detected') {
    return finish({ kind: 'integration', reason: 'secret_detected', verificationRun })
  }
  return finish({
    kind: 'candidate',
    previousSeq,
    candidate,
    verificationRun,
    skippedAttempts
  })
}
