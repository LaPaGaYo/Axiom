import { randomUUID } from 'node:crypto'
import { AttemptReconcileEntrySchema } from '../../../shared/axiom-contract/mission-params'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import { foldAttemptLiveness } from '../execution/attempt-projection'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { archiveAttemptTranscript } from '../execution/attempt-transcript'
import {
  releaseSubmittedWorker,
  releaseFailedWorker,
  shouldHoldWorkerRelease
} from '../execution/attempt-worker-release'
import { z } from 'zod'
import { isHeadlessAttempt } from '../execution/attempt-exit-submission'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { PtyLivenessVerdict } from '../../../shared/pty-liveness-verdict'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { MissionController } from '../mission-controller/mission-controller'

export type RecoveryContext = {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  runtime: OrcaRuntimeService
  artifacts: ArtifactStore
  now: () => number
}
export const activeWorkerStates = new Set([
  'starting',
  'ready',
  'start_unknown',
  'stopping',
  'stop_unknown'
])
export type AttemptBinding = NonNullable<ReturnType<AxiomStore['getAttemptBinding']>>

export function lastAttemptAudit(ctx: RecoveryContext, binding: AttemptBinding, event: string) {
  const objectId = binding.dispatchId ?? `${binding.taskId}/${binding.seq}`
  return z
    .object({ after: z.string().nullable(), created_at: z.string() })
    .optional()
    .parse(
      ctx.db.db
        .prepare(
          `SELECT after, created_at FROM audit_events WHERE mission_id = ? AND object_kind = 'attempt'
     AND object_id = ? AND event = ? ORDER BY sequence DESC LIMIT 1`
        )
        .get(binding.missionId, objectId, event)
    )
}

// Kernel mutations commit independently; replay only writes a new audit when its result changed.
export function auditAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  event: string,
  after: Record<string, AuditEvent['after']>
): boolean {
  const objectId = binding.dispatchId ?? `${binding.taskId}/${binding.seq}`
  const value = { taskId: binding.taskId, seq: binding.seq, ...after }
  const previous = lastAttemptAudit(ctx, binding, event)
  if (previous?.after === JSON.stringify(value)) {
    return false
  }
  ctx.store.appendAuditEvent({
    missionId: binding.missionId,
    actor: 'RecoveryService',
    objectKind: 'attempt',
    objectId,
    event,
    before: null,
    after: value,
    createdAt: new Date(ctx.now()).toISOString()
  })
  return true
}

export function observeAttemptLiveness(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  verdict: PtyLivenessVerdict
): number {
  const dispatchId = binding.dispatchId!
  return ctx.store.transaction('attempt_liveness', () => {
    const facts = ctx.db.getAttemptObservationFacts(dispatchId)
    const latest = facts.findLast((fact) => fact.facet === 'liveness')
    if (latest?.facet === 'liveness' && latest.payload.status === verdict.status) {
      return latest.homeReceivedAt
    }
    // Initial live observations need no persistence; only uncertainty and its recovery change the clock.
    if (verdict.status === 'live' && latest?.facet !== 'liveness') {
      return ctx.now()
    }
    const since = ctx.now()
    ctx.db.recordAttemptObservation({
      id: `liveness_${randomUUID()}`,
      dispatchId,
      sequence: (facts.at(-1)?.sequence ?? -1) + 1,
      authorityId: 'axiom-control-plane',
      authorityClock: 'home',
      facet: 'liveness',
      payload: verdict,
      sourceObservedAt: null,
      executionReceivedAt: null,
      homeReceivedAt: since
    })
    if (verdict.status === 'unverifiable') {
      auditAttempt(ctx, binding, 'attempt.unverifiable', { reason: verdict.reason, since })
    }
    return since
  })
}

export async function abandonmentEvidence(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  liveness: PtyLivenessVerdict,
  since: number,
  toleranceMinutes: number
) {
  const dispatchId = binding.dispatchId!
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  return ctx.artifacts.put({
    missionId: binding.missionId,
    kind: 'evidence',
    mediaType: 'application/json',
    related: [binding.taskId, dispatchId],
    createdBy: 'RecoveryService',
    content: Buffer.from(
      JSON.stringify({
        taskId: binding.taskId,
        attemptId: dispatchId,
        seq: binding.seq,
        branch: binding.branch,
        worktreeId: worker?.worktree_id ?? null,
        workerState: worker?.state ?? null,
        dispatchStatus: ctx.db.getDispatchContextById(dispatchId)?.status,
        liveness,
        since,
        abandonedAt: ctx.now(),
        toleranceMinutes,
        observationFacts: ctx.db.getAttemptObservationFacts(dispatchId)
      })
    )
  })
}

export async function releaseSubmission(
  ctx: RecoveryContext,
  binding: AttemptBinding
): Promise<string | undefined> {
  const dispatchId = binding.dispatchId!
  const submission = ctx.store.getSubmissionByDispatch(dispatchId)
  const resource = ctx.db.getWorkerTerminalResourceByOwner(dispatchId)
  if (
    !submission ||
    !resource ||
    shouldHoldWorkerRelease() ||
    !['not_requested', 'retained', 'requested'].includes(resource.release_state) ||
    !(ctx.now() - Date.parse(exposeUtcTimestamp(submission.createdAt)!) >= 60_000)
  ) {
    return
  }
  const archived = ctx.store
    .listAuditEvents({ missionId: binding.missionId })
    .some(
      (audit) =>
        audit.objectKind === 'attempt' &&
        audit.objectId === dispatchId &&
        ['attempt.transcript_archived', 'attempt.transcript_archive_failed'].includes(
          audit.event
        ) &&
        z.object({ submissionId: z.literal(submission.id) }).safeParse(audit.after).success
    )
  if (!archived) {
    await archiveAttemptTranscript(ctx.runtime, submission)
  }
  return releaseSubmittedWorker(ctx.runtime, submission)
}

export async function releaseFailedHeadlessAttempt(ctx: RecoveryContext, binding: AttemptBinding) {
  const attemptId = binding.dispatchId!
  const worker = ctx.db.getWorkerDispatch(attemptId)
  const resource = ctx.db.getWorkerTerminalResourceByOwner(attemptId)
  const failure = lastAttemptAudit(ctx, binding, 'attempt.failed')
  if (
    !isHeadlessAttempt(worker) ||
    worker?.state !== 'failed' ||
    ctx.store.getSubmissionByDispatch(attemptId) ||
    !failure ||
    !resource ||
    shouldHoldWorkerRelease() ||
    !['not_requested', 'retained', 'requested'].includes(resource.release_state) ||
    !(ctx.now() - Date.parse(exposeUtcTimestamp(failure.created_at)!) >= 60_000)
  ) {
    return
  }
  return releaseFailedWorker(ctx.runtime, { missionId: binding.missionId, attemptId })
}

export async function cancelAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>
): Promise<string> {
  const dispatchId = binding.dispatchId!
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  // Submitted Attempts use the archive/grace release path above; cancellation never stops them.
  if (worker?.state === 'succeeded' || ctx.store.getSubmissionByDispatch(dispatchId)) {
    return 'unchanged'
  }
  let state: string | undefined = worker?.state
  let disposition: string | undefined
  if (worker && activeWorkerStates.has(worker.state)) {
    if (worker.state !== 'stop_unknown' && observation.exact && observation.status === 'live') {
      state = z
        .object({ state: z.string() })
        .parse(await stopLocalWorker(ctx.runtime, dispatchId)).state
    } else {
      // A current stop owns its outcome until it finishes; next tick retries the durable cancellation.
      if (worker.state === 'stopping') {
        return 'stopping'
      }
      const abandoned = ctx.db.abandonWorkerDispatch(
        dispatchId,
        ctx.runtime.getRuntimeId(),
        'RecoveryService'
      )
      disposition = abandoned.disposition
      state = ctx.db.getWorkerDispatch(dispatchId)?.state
    }
  }
  if (state === 'stop_unknown') {
    ctx.store.transaction('recovery_cancel_unknown', () =>
      auditAttempt(ctx, binding, 'attempt.stop_unknown', { reason: 'mission_canceled' })
    )
    return state
  }
  if (state && activeWorkerStates.has(state)) {
    return 'unchanged'
  }
  // Retry release even after a crash between the kernel settlement and this consequence.
  const release = await releaseLocalWorker(ctx.runtime, dispatchId)
  const event =
    state === 'stopped'
      ? 'attempt.stopped'
      : state === 'abandoned'
        ? 'attempt.abandoned'
        : 'attempt.terminal_released'
  // Preserve the liveness at abandonment on release-only replays, even if the host changes later.
  const previousStop = z
    .object({
      priorStop: z.literal('stop_unknown'),
      liveness: AttemptReconcileEntrySchema.shape.liveness.unwrap()
    })
    .safeParse(JSON.parse(lastAttemptAudit(ctx, binding, event)?.after ?? 'null'))
  const stopContext: Record<string, string> =
    worker?.state === 'stop_unknown'
      ? { priorStop: 'stop_unknown', liveness: foldAttemptLiveness(observation) }
      : previousStop.success
        ? previousStop.data
        : {}
  const changed = ctx.store.transaction('recovery_cancel_release', () =>
    auditAttempt(ctx, binding, event, {
      reason: 'mission_canceled',
      ...(state === 'abandoned' ? { disposition: disposition ?? 'abandoned' } : {}),
      ...stopContext,
      release
    })
  )
  return changed ? (state ?? 'released') : 'unchanged'
}
