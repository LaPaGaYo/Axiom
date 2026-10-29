import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import { z } from 'zod'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopPlanner } from '../execution/planner-stop'
import type { observeAgentExit } from './agent-exit-observation'
import {
  abandonmentEvidence,
  auditAttempt,
  lastAttemptAudit,
  observeAttemptLiveness,
  type RecoveryContext,
  type AttemptBinding
} from './attempt-recovery-effects'

export const PLANNER_RUNTIME_BUDGET_MINUTES = 30

export async function reconcilePlanner(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>,
  entry: AttemptReconcileEntry,
  agentExit: Awaited<ReturnType<typeof observeAgentExit>>
): Promise<AttemptReconcileEntry> {
  const { db, store, runtime } = ctx
  const dispatchId = binding.dispatchId!
  const worker = db.getWorkerDispatch(dispatchId)
  if (!worker) {
    return entry
  }
  const proposed = Boolean(lastAttemptAudit(ctx, binding, 'planner.proposed'))
  if (['failed', 'stopped', 'abandoned'].includes(worker.state)) {
    const failed = lastAttemptAudit(ctx, binding, 'planner.attempt_failed')
    if (!proposed && !failed) {
      auditAttempt(ctx, binding, 'planner.attempt_failed', { reason: 'no_proposal' })
    }
    if (
      !proposed &&
      z
        .object({ reason: z.literal('no_proposal'), evidence: z.literal('turn_settled') })
        .safeParse(JSON.parse(failed?.after ?? 'null')).success &&
      !lastAttemptAudit(ctx, binding, 'planner.stopped')
    ) {
      // The kernel stop can commit before its caller writes the receipt. Reuse
      // the idempotent stop path, including its overlap and audit deduplication.
      await stopPlanner(runtime, store, { missionId: binding.missionId, dispatchId }, 'no_proposal')
      entry.action = 'attempt_failed'
      return entry
    }
    const release = await releaseLocalWorker(runtime, dispatchId)
    if (proposed) {
      auditAttempt(ctx, binding, 'planner.stopped', {
        state: worker.state,
        releaseDisposition: release.state,
        reason: 'plan_proposed'
      })
    }
    entry.action = proposed ? 'released' : 'attempt_failed'
    return entry
  }
  const stopUnknown = worker.state === 'stop_unknown'
  if (!stopUnknown && entry.liveness === 'exited') {
    db.failDispatch(dispatchId, 'Planner process exited', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    if (!proposed && !lastAttemptAudit(ctx, binding, 'planner.attempt_failed')) {
      auditAttempt(ctx, binding, 'planner.attempt_failed', {
        reason: 'no_proposal',
        ...(agentExit.exited ? { evidence: agentExit.evidence } : {})
      })
    }
    await releaseLocalWorker(runtime, dispatchId)
    entry.action = proposed ? 'released' : 'attempt_failed'
    return entry
  }
  const policy = store.getPolicy(binding.missionId)!
  if (!stopUnknown && entry.liveness === 'live') {
    observeAttemptLiveness(ctx, binding, { status: 'live', ptyIds: [] })
    const minutes = policy.budget.maxRuntimeMinutes ?? PLANNER_RUNTIME_BUDGET_MINUTES
    const failed = Boolean(lastAttemptAudit(ctx, binding, 'planner.attempt_failed'))
    if (
      proposed ||
      failed ||
      ctx.now() - Date.parse(exposeUtcTimestamp(binding.createdAt)!) > minutes * 60_000
    ) {
      entry.action = await stopPlanner(
        runtime,
        store,
        { missionId: binding.missionId, dispatchId },
        proposed ? 'plan_proposed' : failed ? 'no_proposal' : 'runtime_budget_exceeded'
      )
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
  if (
    ctx.now() - since < policy.unverifiableToleranceMinutes * 60_000 ||
    worker.state === 'stopping' ||
    worker.state === 'succeeded'
  ) {
    return entry
  }
  const evidence = await abandonmentEvidence(
    ctx,
    binding,
    verdict,
    since,
    policy.unverifiableToleranceMinutes
  )
  // Host IO may have overlapped proposal settlement or a kernel state transition.
  if (db.getWorkerDispatch(dispatchId)?.state !== worker.state) {
    return entry
  }
  if (db.getDispatchContext(binding.taskId)?.id !== dispatchId) {
    return { ...entry, action: 'stale' }
  }
  const disposition = db.abandonWorkerDispatch(
    dispatchId,
    runtime.getRuntimeId(),
    'RecoveryService'
  ).disposition
  auditAttempt(ctx, binding, 'planner.abandoned', {
    reason: 'unverifiable_tolerance_exceeded',
    disposition,
    evidenceArtifactId: evidence.id
  })
  await releaseLocalWorker(runtime, dispatchId)
  entry.action = 'abandoned'
  return entry
}
