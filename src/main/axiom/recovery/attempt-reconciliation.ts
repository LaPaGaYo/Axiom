import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { z } from 'zod'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import {
  AttemptReconcileEntrySchema,
  type AttemptReconcileEntry
} from '../../../shared/axiom-contract/mission-params'
import { resolveWorkerStartReadinessTimeoutMs } from '../../../shared/orchestration-timing-budgets'
import { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import { foldAttemptLiveness } from '../execution/attempt-projection'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import { reconcilePlanner } from './planner-reconciliation'
import {
  abandonmentEvidence,
  auditAttempt,
  lastAttemptAudit,
  observeAttemptLiveness,
  retainSubmission,
  type AttemptBinding,
  type RecoveryContext
} from './attempt-recovery-effects'

const StopReceipt = z.object({ state: z.string() })
const activeStates = new Set(['starting', 'ready', 'start_unknown', 'stopping', 'stop_unknown'])
const terminalReasons = new Map([
  ['failed', 'attempt_failed'],
  ['stopped', 'attempt_stopped'],
  ['abandoned', 'attempt_abandoned']
])

function currentRunning(ctx: RecoveryContext, binding: AttemptBinding): boolean {
  return (
    ctx.store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
    ctx.store.nextAttemptSeq(binding.taskId) === binding.seq + 1 &&
    !(binding.dispatchId && ctx.store.getSubmissionByDispatch(binding.dispatchId))
  )
}

function settle(ctx: RecoveryContext, binding: AttemptBinding, reason: string) {
  return settleAttemptWithoutSubmission(ctx, { ...binding, reason, actor: 'RecoveryService' })
}

export async function reconcileAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding
): Promise<AttemptReconcileEntry> {
  const { db, store, runtime } = ctx
  const { dispatchId, taskId, seq } = binding
  const planner = store.getAgentSpec(binding.agentSpecId)?.spec.role === 'planner'
  const entry: AttemptReconcileEntry = {
    attemptId: dispatchId,
    taskId,
    seq,
    liveness: null,
    action: 'unchanged'
  }
  if (!dispatchId) {
    if (planner) {
      if (
        !lastAttemptAudit(ctx, binding, 'planner.launch_failed') &&
        ctx.now() - Date.parse(exposeUtcTimestamp(binding.createdAt)!) >
          2 * resolveWorkerStartReadinessTimeoutMs(undefined)
      ) {
        auditAttempt(ctx, binding, 'planner.attempt_failed', { reason: 'launch_pending_orphan' })
        entry.action = 'launch_pending_orphan'
      }
      return entry
    }
    if (
      currentRunning(ctx, binding) &&
      ctx.now() - Date.parse(exposeUtcTimestamp(binding.createdAt)!) >
        2 * resolveWorkerStartReadinessTimeoutMs(undefined)
    ) {
      store.transaction('orphan_launch', () => {
        auditAttempt(ctx, binding, 'attempt.launch_pending_orphan', {
          reason: 'launch_pending_orphan'
        })
        settle(ctx, binding, 'launch_pending_orphan')
      })
      entry.action = 'launch_pending_orphan'
    }
    return entry
  }
  let worker = db.getWorkerDispatch(dispatchId)
  if (worker && worker.runtime_epoch !== runtime.getRuntimeId()) {
    if (worker.state === 'starting') {
      worker = db.markWorkerStartUnknown(
        dispatchId,
        worker.stage,
        'The runtime restarted before worker-start reached a terminal receipt.'
      )
    } else if (worker.state === 'stopping') {
      worker = db.markWorkerStopUnknown(
        dispatchId,
        'The runtime restarted before worker-stop reached a terminal receipt.'
      )
    }
  }
  const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
  entry.liveness = foldAttemptLiveness(observation)
  // Inspection and kernel calls await host IO. Always re-read durable authority afterwards.
  const task = store.getTaskStage(taskId)
  const mission = store.getMission(binding.missionId)
  worker = db.getWorkerDispatch(dispatchId)
  if (!mission) {
    return entry
  }
  if (task?.stage === 'CANCELED' || TERMINAL_MISSION_STATUSES.has(mission.status)) {
    entry.action = await cancelAttempt(ctx, binding, observation)
    return entry
  }
  if (planner) return reconcilePlanner(ctx, binding, observation, entry)
  if (!task) return entry
  if (task.stage === 'SUBMITTED') {
    entry.action = retainSubmission(ctx, binding) ?? 'unchanged'
    return entry
  }
  if (!currentRunning(ctx, binding)) {
    return entry
  }
  const terminalReason = worker && terminalReasons.get(worker.state)
  if (terminalReason) {
    store.transaction('recovery_terminal', () => {
      // Reattach evidence if the process died after kernel abandonment but before Axiom settlement.
      const evidence =
        worker?.state === 'abandoned'
          ? store
              .listArtifacts({
                missionId: binding.missionId,
                relatedTo: dispatchId,
                kind: 'evidence'
              })
              .findLast((artifact) => artifact.createdBy === 'RecoveryService')
          : undefined
      if (evidence) {
        auditAttempt(ctx, binding, 'attempt.abandoned', {
          reason: 'unverifiable_tolerance_exceeded',
          evidenceArtifactId: evidence.id,
          disposition: 'abandoned'
        })
      }
      settle(ctx, binding, evidence ? 'unverifiable_tolerance_exceeded' : terminalReason)
    })
    entry.action = terminalReason
    return entry
  }
  // The kernel refuses a second stop; a stop_unknown receipt must use the tolerance clock.
  const stopUnknown = worker?.state === 'stop_unknown'
  if (!stopUnknown && entry.liveness === 'exited' && worker && activeStates.has(worker.state)) {
    store.transaction('recovery_process_exit', () => {
      // failDispatch owns a savepoint and is explicitly safe inside the Axiom transaction.
      db.failDispatch(dispatchId, 'Worker process exited without a Submission', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
      auditAttempt(ctx, binding, 'attempt.failed', { reason: 'process_exited' })
      settle(ctx, binding, 'attempt_failed')
    })
    entry.action = 'failed'
    return entry
  }
  const policy = store.getPolicy(binding.missionId)!
  if (!stopUnknown && entry.liveness === 'live') {
    observeAttemptLiveness(ctx, binding, { status: 'live', ptyIds: [] })
    const minutes = task.spec.budget?.maxRuntimeMinutes ?? policy.budget.maxRuntimeMinutes
    if (
      minutes !== undefined &&
      ctx.now() - Date.parse(exposeUtcTimestamp(binding.createdAt)!) > minutes * 60_000
    ) {
      const stopped = StopReceipt.parse(await stopLocalWorker(runtime, dispatchId))
      store.transaction('recovery_runtime_budget', () => {
        if (stopped.state === 'stopped') {
          auditAttempt(ctx, binding, 'attempt.stopped', { reason: 'runtime_budget_exceeded' })
          settle(ctx, binding, 'runtime_budget_exceeded')
        } else if (stopped.state === 'stop_unknown') {
          auditAttempt(ctx, binding, 'attempt.stop_unknown', { reason: 'runtime_budget_exceeded' })
        }
      })
      entry.action = stopped.state
    }
    return entry
  }
  if (!stopUnknown && entry.liveness !== 'unverifiable') {
    return entry
  }
  const verdict = {
    status: 'unverifiable' as const,
    reason: stopUnknown ? 'stop_unknown' : (observation.reason ?? observation.status)
  }
  const since = observeAttemptLiveness(ctx, binding, verdict)
  if (ctx.now() - since < policy.unverifiableToleranceMinutes * 60_000) {
    return entry
  }
  // A same-runtime start/stop can still be in flight; never revoke it under its kernel transaction.
  if (worker?.state === 'stopping' || worker?.state === 'succeeded') {
    return entry
  }
  const evidence = await abandonmentEvidence(
    ctx,
    binding,
    verdict,
    since,
    policy.unverifiableToleranceMinutes
  )
  if (!currentRunning(ctx, binding)) {
    return entry
  }
  // Evidence IO may overlap a kernel exit or stop. Re-read its receipt before claiming abandonment.
  if (db.getWorkerDispatch(dispatchId)?.state !== worker?.state) {
    return reconcileAttempt(ctx, binding)
  }
  const disposition = db.abandonWorkerDispatch(dispatchId).disposition
  if (disposition === 'stale') {
    entry.action = 'stale'
    return entry
  }
  store.transaction('recovery_abandon', () => {
    auditAttempt(ctx, binding, 'attempt.abandoned', {
      reason: 'unverifiable_tolerance_exceeded',
      evidenceArtifactId: evidence.id,
      disposition
    })
    settle(ctx, binding, 'unverifiable_tolerance_exceeded')
  })
  entry.action = 'abandoned'
  return entry
}

async function cancelAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>
): Promise<string> {
  const dispatchId = binding.dispatchId!
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  // A settled Candidate retains its resource until the Candidate lifecycle releases it.
  if (worker?.state === 'succeeded' || ctx.store.getSubmissionByDispatch(dispatchId)) {
    return 'unchanged'
  }
  let state: string | undefined = worker?.state
  let disposition: string | undefined
  if (worker && activeStates.has(worker.state)) {
    if (worker.state !== 'stop_unknown' && observation.exact && observation.status === 'live') {
      state = StopReceipt.parse(await stopLocalWorker(ctx.runtime, dispatchId)).state
    } else {
      // A current stop owns its outcome until it finishes; next tick retries the durable cancellation.
      if (worker.state === 'stopping') {
        return 'stopping'
      }
      const abandoned = ctx.db.abandonWorkerDispatch(dispatchId)
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
  if (state && activeStates.has(state)) {
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
