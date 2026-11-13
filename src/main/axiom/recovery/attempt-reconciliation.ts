import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import { resolveWorkerStartReadinessTimeoutMs } from '../../../shared/orchestration-timing-budgets'
import { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { foldAttemptLiveness } from '../execution/attempt-projection'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import { reconcilePlanner } from './planner-reconciliation'
import { superviseAttempt } from './attempt-supervision'
import { observeAgentExit } from './agent-exit-observation'
import { isHeadlessAttempt, submitExitedAttempt } from '../execution/attempt-exit-submission'
import { isUnusableHeadlessLaunch } from '../execution/headless-launch-record'
import { watchHeadlessAttempt } from '../execution/headless-attempt-watcher'
import { captureRecoveryAttempt, recoveryEndingStillCurrent } from './attempt-recovery-preservation'
import {
  isRestartTerminalMissing,
  hasAcceptedExitMarker,
  settleRecoveryDaemonLoss
} from './attempt-daemon-loss'
import { settleRecoveryTerminal, settleRecoveryProcessExit } from './attempt-recovery-endings'
import {
  abandonmentEvidence,
  activeWorkerStates as activeStates,
  cancelAttempt,
  auditAttempt,
  lastAttemptAudit,
  observeAttemptLiveness,
  releaseSubmission,
  releaseFailedHeadlessAttempt,
  type AttemptBinding,
  type RecoveryContext
} from './attempt-recovery-effects'

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
    const effect = store.getEffect('attempt.dispatch', `${taskId}/${seq}`)
    if (effect?.status === 'pending') {
      return entry
    }
    const launchSince = effect?.status === 'running' ? effect.updatedAt : binding.createdAt
    if (
      currentRunning(ctx, binding) &&
      ctx.now() - Date.parse(exposeUtcTimestamp(launchSince)!) >
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
  const headless = !planner && isHeadlessAttempt(worker)
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
  if (headless && currentRunning(ctx, binding)) {
    // An unusable launch must not prevent host-proven recovery endings.
    const result = await submitExitedAttempt(runtime, dispatchId).catch((error) => {
      if (isUnusableHeadlessLaunch(error)) {
        return 'unchanged'
      }
      throw error
    })
    if (result === 'unchanged_candidate' || result === 'declared') {
      return { ...entry, action: 'failed', liveness: 'exited' }
    }
    if (result === 'submitted' || result === 'failed' || result === 'interrupted') {
      return { ...entry, action: result, liveness: 'exited' }
    }
    if (result === 'pending') {
      watchHeadlessAttempt(runtime, dispatchId)
    }
  }
  const observation = await inspectWorkerTerminal(runtime, db, dispatchId)
  const agentExit = headless
    ? { exited: false as const }
    : await observeAgentExit(ctx, binding, observation, worker)
  entry.liveness = agentExit.exited ? 'exited' : foldAttemptLiveness(observation)
  // Inspection and kernel calls await host IO. Always re-read durable authority afterwards.
  const task = store.getTaskStage(taskId)
  const mission = store.getMission(binding.missionId)
  worker = db.getWorkerDispatch(dispatchId)
  if (!mission) {
    return entry
  }
  // Submission owns release independently of verification, cancellation, or Mission status.
  if (!planner && store.getSubmissionByDispatch(dispatchId)) {
    entry.action = (await releaseSubmission(ctx, binding)) ?? 'unchanged'
    return entry
  }
  if (headless && worker?.state === 'failed' && lastAttemptAudit(ctx, binding, 'attempt.failed')) {
    entry.action = (await releaseFailedHeadlessAttempt(ctx, binding)) ?? 'unchanged'
    return entry
  }
  if (task?.stage === 'CANCELED' || TERMINAL_MISSION_STATUSES.has(mission.status)) {
    entry.action = await cancelAttempt(ctx, binding, observation)
    return entry
  }
  if (planner) {
    return reconcilePlanner(ctx, binding, observation, entry, agentExit)
  }
  if (!task) {
    return entry
  }
  if (!currentRunning(ctx, binding)) {
    return entry
  }
  if (headless && db.getDispatchContext(taskId)?.id !== dispatchId) {
    entry.action = 'stale'
    return entry
  }
  const terminalReason = worker && terminalReasons.get(worker.state)
  if (terminalReason && worker) {
    if (
      headless &&
      isRestartTerminalMissing(worker, runtime.getRuntimeId()) &&
      !(await hasAcceptedExitMarker(dispatchId))
    ) {
      const preserved = await captureRecoveryAttempt(ctx, binding, 'terminal_missing')
      if (
        !recoveryEndingStillCurrent(ctx, binding, worker) ||
        !isRestartTerminalMissing(db.getWorkerDispatch(dispatchId), runtime.getRuntimeId())
      ) {
        return reconcileAttempt(ctx, binding)
      }
      settleRecoveryDaemonLoss(ctx, { ...binding, dispatchId }, worker, preserved)
      entry.action = 'interrupted'
      return entry
    }
    // kernel_stopped records a kernel receipt that has no Axiom stop settlement yet.
    const preserved =
      headless && worker.state === 'stopped'
        ? await captureRecoveryAttempt(ctx, binding, 'stopped')
        : undefined
    if (headless && !recoveryEndingStillCurrent(ctx, binding, worker)) {
      return reconcileAttempt(ctx, binding)
    }
    settleRecoveryTerminal(ctx, binding, worker, terminalReason, 'kernel_failed', preserved)
    entry.action = terminalReason
    return entry
  }
  // The kernel refuses a second stop; a stop_unknown receipt must use the tolerance clock.
  const stopUnknown = worker?.state === 'stop_unknown'
  if (!stopUnknown && entry.liveness === 'exited' && worker && activeStates.has(worker.state)) {
    const preserved = headless ? await captureRecoveryAttempt(ctx, binding, 'exited') : undefined
    if (headless && !recoveryEndingStillCurrent(ctx, binding, worker)) {
      return reconcileAttempt(ctx, binding)
    }
    entry.action = settleRecoveryProcessExit(
      ctx,
      { ...binding, dispatchId },
      worker,
      headless,
      agentExit.exited ? agentExit.evidence : undefined,
      preserved
    )
    return entry
  }
  const policy = store.getPolicy(binding.missionId)!
  if (!stopUnknown && entry.liveness === 'live') {
    observeAttemptLiveness(ctx, binding, { status: 'live', ptyIds: [] })
    return superviseAttempt(ctx, binding, entry, {
      headless,
      maxTokens: task.spec.budget?.maxTokens,
      minutes: task.spec.budget?.maxRuntimeMinutes ?? policy.budget.maxRuntimeMinutes,
      thresholdSource: task.spec.budget?.maxRuntimeMinutes === undefined ? 'policy' : 'task',
      startedAt: Date.parse(exposeUtcTimestamp(binding.createdAt)!),
      stop: () => stopLocalWorker(runtime, dispatchId),
      reconcile: () => reconcileAttempt(ctx, binding)
    })
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
  if (db.getDispatchContext(binding.taskId)?.id !== dispatchId) {
    entry.action = 'stale'
    return entry
  }
  const disposition = db.abandonWorkerDispatch(
    dispatchId,
    runtime.getRuntimeId(),
    'RecoveryService'
  ).disposition
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
