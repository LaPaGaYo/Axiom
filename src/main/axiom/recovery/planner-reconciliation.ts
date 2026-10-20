import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import { stopPlanner } from '../execution/planner-stop'
import {
  abandonmentEvidence,
  auditAttempt,
  lastAttemptAudit,
  observeAttemptLiveness,
  type RecoveryContext,
  type AttemptBinding
} from './attempt-recovery-effects'

export async function reconcilePlanner(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>,
  entry: AttemptReconcileEntry
): Promise<AttemptReconcileEntry> {
  const { db, store, runtime } = ctx
  const dispatchId = binding.dispatchId!
  const worker = db.getWorkerDispatch(dispatchId)
  if (!worker) return entry
  const proposed = Boolean(lastAttemptAudit(ctx, binding, 'planner.proposed'))
  if (['failed', 'stopped', 'abandoned'].includes(worker.state)) {
    if (!proposed) auditAttempt(ctx, binding, 'planner.attempt_failed', { reason: 'no_proposal' })
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
    if (!proposed) auditAttempt(ctx, binding, 'planner.attempt_failed', { reason: 'no_proposal' })
    await releaseLocalWorker(runtime, dispatchId)
    entry.action = proposed ? 'released' : 'attempt_failed'
    return entry
  }
  const policy = store.getPolicy(binding.missionId)!
  if (!stopUnknown && entry.liveness === 'live') {
    observeAttemptLiveness(ctx, binding, { status: 'live', ptyIds: [] })
    const minutes = policy.budget.maxRuntimeMinutes
    if (
      proposed ||
      (minutes !== undefined &&
        ctx.now() - Date.parse(exposeUtcTimestamp(binding.createdAt)!) > minutes * 60_000)
    ) {
      entry.action = await stopPlanner(
        runtime,
        store,
        { missionId: binding.missionId, dispatchId },
        proposed ? 'plan_proposed' : 'runtime_budget_exceeded'
      )
    }
    return entry
  }
  if (!stopUnknown && entry.liveness !== 'unverifiable') return entry
  const verdict = {
    status: 'unverifiable' as const,
    reason: stopUnknown ? 'stop_unknown' : (observation.reason ?? observation.status)
  }
  const since = observeAttemptLiveness(ctx, binding, verdict)
  if (
    ctx.now() - since < policy.unverifiableToleranceMinutes * 60_000 ||
    worker.state === 'stopping' ||
    worker.state === 'succeeded'
  )
    return entry
  const evidence = await abandonmentEvidence(
    ctx,
    binding,
    verdict,
    since,
    policy.unverifiableToleranceMinutes
  )
  // Host IO may have overlapped proposal settlement or a kernel state transition.
  if (db.getWorkerDispatch(dispatchId)?.state !== worker.state) return entry
  const disposition = db.abandonWorkerDispatch(dispatchId).disposition
  if (disposition === 'stale') return { ...entry, action: 'stale' }
  auditAttempt(ctx, binding, 'planner.abandoned', {
    reason: 'unverifiable_tolerance_exceeded',
    disposition,
    evidenceArtifactId: evidence.id
  })
  await releaseLocalWorker(runtime, dispatchId)
  entry.action = 'abandoned'
  return entry
}
