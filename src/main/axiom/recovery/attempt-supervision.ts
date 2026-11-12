import { statSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { AttemptReconcileEntry } from '../../../shared/axiom-contract/mission-params'
import { headlessAttemptDirectory } from '../execution/headless-attempt-files'
import { auditAttempt, type AttemptBinding, type RecoveryContext } from './attempt-recovery-effects'
import { captureRecoveryAttempt, recoveryEndingStillCurrent } from './attempt-recovery-preservation'
import { settleRecoveryBudget } from './attempt-recovery-endings'
import { sampleAttemptCadence } from './attempt-cadence'
import { stallThresholdForPass } from './supervision-policy'

const StopReceipt = z.object({ state: z.string() })
type SupervisionInput = {
  headless: boolean
  startedAt: number
  minutes: number | undefined
  thresholdSource: 'task' | 'policy'
  stop: () => Promise<unknown>
  reconcile: () => Promise<AttemptReconcileEntry>
}

function lastEventTime(attemptId: string): number | undefined {
  try {
    const file = statSync(path.join(headlessAttemptDirectory(attemptId), 'events.jsonl'))
    return file.isFile() && Number.isFinite(file.mtimeMs) ? file.mtimeMs : undefined
  } catch {
    // ENOENT means the harness has not written yet. Other stat failures also skip this sample.
    return undefined
  }
}

function observeStall(ctx: RecoveryContext, binding: AttemptBinding, startedAt: number) {
  if (!binding.dispatchId) {
    return
  }
  const lastEventAt = lastEventTime(binding.dispatchId)
  if (lastEventAt === undefined) {
    return
  }
  const now = ctx.now()
  const idleMs = Math.max(0, now - lastEventAt)
  sampleAttemptCadence(ctx, binding, startedAt, now, idleMs)
  const observed = ctx.db.db
    .prepare(`SELECT 1 FROM audit_events
    WHERE mission_id = ? AND object_kind = 'attempt' AND object_id = ?
    AND event = 'attempt.supervised' AND json_extract(after, '$.rule') = 'stalled' LIMIT 1`)
    .get(binding.missionId, binding.dispatchId)
  if (observed !== undefined) {
    return
  }
  const threshold = stallThresholdForPass(ctx)
  if (idleMs > threshold.thresholdMs) {
    auditAttempt(ctx, binding, 'attempt.supervised', {
      rule: 'stalled',
      mode: 'observe',
      ...threshold,
      idleMs,
      lastEventAt: new Date(lastEventAt).toISOString(),
      wouldActAt: new Date(lastEventAt + threshold.thresholdMs).toISOString()
    })
  }
}

export async function superviseAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  entry: AttemptReconcileEntry,
  input: SupervisionInput
): Promise<AttemptReconcileEntry> {
  if (input.headless) {
    observeStall(ctx, binding, input.startedAt)
  }
  const elapsedMs = ctx.now() - input.startedAt
  if (input.minutes !== undefined && elapsedMs > input.minutes * 60_000) {
    const stopped = StopReceipt.parse(await input.stop())
    const stoppedWorker = binding.dispatchId
      ? ctx.db.getWorkerDispatch(binding.dispatchId)
      : undefined
    const preserved =
      input.headless && stopped.state === 'stopped'
        ? await captureRecoveryAttempt(ctx, binding, 'stopped')
        : undefined
    if (
      input.headless &&
      (stoppedWorker?.state !== stopped.state ||
        !recoveryEndingStillCurrent(ctx, binding, stoppedWorker))
    ) {
      return input.reconcile()
    }
    settleRecoveryBudget(
      ctx,
      binding,
      stopped.state,
      {
        thresholdMs: input.minutes * 60_000,
        thresholdSource: input.thresholdSource,
        elapsedMs
      },
      preserved
    )
    entry.action = stopped.state
  }
  return entry
}
