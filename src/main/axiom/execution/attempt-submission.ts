import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { AttemptSubmitParams } from '../../../shared/axiom-contract/attempt-params'
import {
  SubmissionReportSchema,
  type SubmissionReport
} from '../../../shared/axiom-contract/submission-params'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import { AxiomMessagePayloadSchema } from '../../../shared/axiom-contract/message-params'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import { runKeyedSerializedOperation } from '../../cli/keyed-promise-queue'
import type { RpcContext } from '../../runtime/rpc/core'
import { sha256 } from '../artifacts/artifact-store'
import { getAxiomControlPlane } from '../control-plane'
import { routeWorkerMessage } from '../messaging/message-router'
import { resolveAttemptSender } from './attempt-authority'
import { snapshotCandidate } from './candidate-snapshot'
import { archiveAttemptTranscript } from './attempt-transcript'
import { scheduleSubmittedWorkerRelease } from './attempt-worker-release'

// Only concurrent Git work is serialized here. Durable idempotency remains in SQLite/receipts.
const queues = new WeakMap<OrchestrationDb, Map<string, Promise<void>>>()
export function submitAttempt(p: z.infer<typeof AttemptSubmitParams>, ctx: RpcContext) {
  const db = ctx.runtime.getOrchestrationDb()
  const { store } = getAxiomControlPlane(ctx.runtime)
  return serializeAttemptSubmission(db, p.attemptId, () =>
    settleSubmission(p, ctx, {
      resolveAuthority: () =>
        resolveAttemptSender({
          runtime: ctx.runtime,
          db,
          store,
          ...p,
          orchestrationCaller: ctx.orchestrationCaller,
          orchestrationCompatibilityEvidence: ctx.orchestrationCompatibilityEvidence,
          allowSubmissionReplay: true
        })
    })
  )
}

export function serializeAttemptSubmission<T>(
  db: OrchestrationDb,
  attemptId: string,
  operation: () => Promise<T>
) {
  let queue = queues.get(db)
  if (!queue) {
    queue = new Map()
    queues.set(db, queue)
  }
  return runKeyedSerializedOperation(queue, attemptId, operation)
}

// Callers supply their authority check; Git and the settlement transaction are shared.
export async function settleSubmission(
  input: { attemptId: string; report: SubmissionReport },
  ctx: RpcContext,
  options: {
    resolveAuthority: () => ReturnType<typeof resolveAttemptSender>
    headless?: boolean
    finalizeReport?: (
      snapshot: Awaited<ReturnType<typeof snapshotCandidate>>
    ) => Promise<SubmissionReport>
    audit?: Record<string, AuditEvent['after']>
  }
) {
  const { runtime, recordMutationReceipt } = ctx
  const db = runtime.getOrchestrationDb()
  const { store, missions, verification: verificationService } = getAxiomControlPlane(runtime)
  const { mission, task, binding, sender } = options.resolveAuthority()
  const parsed = SubmissionReportSchema.safeParse(input.report)
  if (!parsed.success) {
    throw new OrchestrationError('invalid_argument', 'Invalid Submission report.')
  }
  const { attemptId } = input
  let report = parsed.data
  const existing = store.getSubmissionByDispatch(attemptId)
  const validateArtifacts = () => {
    for (const id of report.artifacts) {
      const artifact = store.getArtifact(id)
      if (
        artifact?.missionId !== mission.id ||
        !artifact.related.some((id) => id === task.taskId || id === attemptId)
      ) {
        throw new OrchestrationError(
          'invalid_argument',
          'Submission Artifact must belong to this Mission and relate to the Task or Attempt.'
        )
      }
    }
  }
  // Mail carries a bounded summary; the immutable Submission keeps the full report.
  const summary = existing?.report.summary ?? report.summary
  const message = AxiomMessagePayloadSchema.safeParse({
    axiom: {
      version: 1,
      type: 'SUBMISSION',
      missionId: mission.id,
      taskId: task.taskId,
      attemptId,
      summary: summary.length > 2000 ? `${summary.slice(0, 1999)}…` : summary,
      artifactIds: existing?.report.artifacts ?? report.artifacts,
      related: {}
    }
  })
  if (!message.success) {
    throw new OrchestrationError(
      'invalid_argument',
      'Submission exceeds the current message contract.'
    )
  }
  const publish = (result: {
    submission: NonNullable<typeof existing>
    candidate: NonNullable<ReturnType<typeof store.getCandidate>>
    duplicate: boolean
  }) => {
    if (!store.listMessages({ missionId: mission.id, attemptId, type: 'SUBMISSION' }).length) {
      routeWorkerMessage(
        { runtime, db, store, recordMutationReceipt: () => recordMutationReceipt?.(result) },
        {
          axiom: { ...message.data.axiom, related: { submissionId: result.submission.id } },
          sender
        }
      )
    } else {
      recordMutationReceipt?.(result)
    }
    return result
  }
  if (existing) {
    const candidate = store.getCandidate(existing.candidateId)
    if (!candidate) {
      throw new OrchestrationError('invalid_argument', 'Submission Candidate is missing.')
    }
    return publish({ submission: existing, candidate, duplicate: true })
  }
  validateArtifacts()
  const worker = db.getWorkerDispatch(attemptId)
  if (!worker?.worktree_id) {
    throw new OrchestrationError('invalid_argument', 'candidate_worktree_missing')
  }
  if (binding.branch !== `axiom/attempt/${task.taskId}/${binding.seq}`) {
    throw new OrchestrationError('invalid_argument', 'candidate_branch_mismatch')
  }
  if (task.stage !== 'RUNNING') {
    throw new OrchestrationError('inactive_dispatch', 'Submission requires a RUNNING Task.')
  }
  const snapshot = await snapshotCandidate({
    attemptId,
    worktreeId: worker.worktree_id,
    branch: binding.branch,
    ...(options.headless ? { headless: true } : {})
  })
  if (options.finalizeReport) {
    report = SubmissionReportSchema.parse(await options.finalizeReport(snapshot))
  }
  const result = runLifecycleWriteTransaction(db.db, 'axiom_submit', () => {
    // A new admission or worker identity during asynchronous Git work must fence this write.
    if (store.nextAttemptSeq(task.taskId) !== binding.seq + 1) {
      throw new OrchestrationError('stale_dispatch', 'A newer Attempt owns this Task.')
    }
    if (db.getDispatchContextById(attemptId)?.status === 'dispatched') {
      options.resolveAuthority()
    }
    validateArtifacts()
    const active = store
      .listCandidates(mission.id)
      .find((candidate) => candidate.taskId === task.taskId && candidate.status === 'ACTIVE')
    if (active && active.attemptId !== attemptId && active.treeSha === snapshot.treeSha) {
      throw new OrchestrationError('invalid_argument', 'candidate_unchanged')
    }
    const candidate = store.insertCandidate({
      id: `cand_${sha256(`${task.taskId}:${snapshot.commitSha}`)}`,
      missionId: mission.id,
      attemptId,
      taskId: task.taskId,
      commitSha: snapshot.commitSha,
      treeSha: snapshot.treeSha,
      status: 'ACTIVE',
      supersededBy: null
    })
    const superseded = store.supersedeActiveCandidates(task.taskId, candidate.id)
    const submission = store.insertSubmission({
      id: `submission_${randomUUID()}`,
      missionId: mission.id,
      attemptId,
      taskId: task.taskId,
      candidateId: candidate.id,
      report
    })
    const homeReceivedAt = Date.now()
    const { sequence } = z
      .object({ sequence: z.number().nullable() })
      .parse(
        db.db
          .prepare(
            'SELECT MAX(sequence) AS sequence FROM attempt_observation_facts WHERE dispatch_id = ?'
          )
          .get(attemptId)
      )
    db.recordAttemptObservation({
      id: `git_${submission.id}`,
      dispatchId: attemptId,
      sequence: (sequence ?? -1) + 1,
      authorityId: 'axiom-control-plane',
      authorityClock: 'home',
      facet: 'artifact_git',
      payload: {
        artifacts: report.artifacts.length ? 'present' : 'absent',
        git: snapshot.snapshotCommitted ? 'changed' : 'clean'
      },
      sourceObservedAt: null,
      executionReceivedAt: null,
      homeReceivedAt
    })
    const settled = db.settleWorkerReportInTransaction({
      taskId: task.taskId,
      dispatchId: attemptId,
      outcome: 'succeeded',
      result: JSON.stringify({
        submissionId: submission.id,
        candidateId: candidate.id,
        filesModified: report.filesChanged,
        reportPath: 'REPORT.md'
      }),
      observation: {
        id: `sub_${submission.id}`,
        authorityId: 'axiom-control-plane',
        homeReceivedAt
      }
    })
    if (settled.action === 'rejected') {
      throw new OrchestrationError(settled.code, settled.reason)
    }
    if (settled.duplicate) {
      throw new OrchestrationError('inactive_dispatch', 'Dispatch settled without this Submission.')
    }
    missions.transitionTaskStage({
      taskId: task.taskId,
      to: 'SUBMITTED',
      actor: 'AttemptSettlement',
      reason: 'submission'
    })
    const verification = store.insertVerificationRun({
      id: `vrun_${randomUUID()}`,
      missionId: mission.id,
      candidateId: candidate.id,
      taskId: task.taskId,
      status: 'QUEUED',
      verdictDetail: {},
      commands: [],
      toolVersions: {},
      verifier: 'VerificationService'
    })
    for (const previous of superseded) {
      store.appendAuditEvent({
        missionId: mission.id,
        actor: 'AttemptSettlement',
        objectKind: 'candidate',
        objectId: previous.id,
        event: 'candidate.superseded',
        before: { status: 'ACTIVE' },
        after: { status: 'SUPERSEDED', supersededBy: candidate.id }
      })
    }
    store.appendAuditEvent({
      missionId: mission.id,
      actor: 'AttemptSettlement',
      objectKind: 'attempt',
      objectId: attemptId,
      event: 'attempt.submitted',
      before: { stage: 'RUNNING' },
      after: {
        stage: 'SUBMITTED',
        taskId: task.taskId,
        submissionId: submission.id,
        candidateId: candidate.id,
        verificationRunId: verification.id,
        ...options.audit
      }
    })
    return { submission, candidate, duplicate: false }
  })
  void verificationService.kick(mission.id).catch(() => {
    console.warn('[axiom] Verification preparation failed', { missionId: mission.id })
  })
  await archiveAttemptTranscript(runtime, result.submission)
  // Never send worker_done through orchestration.send: the dispatch is already settled here.
  publish(result)
  scheduleSubmittedWorkerRelease(runtime, result.submission)
  return result
}
