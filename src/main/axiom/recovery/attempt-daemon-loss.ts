import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import { isHeadlessAttempt } from '../execution/attempt-exit-submission'
import { headlessAttemptDirectory, readHeadlessFile } from '../execution/headless-attempt-files'
import { settleInterruptedAttempt } from '../execution/attempt-interruption'
import { getAxiomControlPlane } from '../control-plane'
import type { captureRecoveryAttempt } from './attempt-recovery-preservation'
import { auditAttempt, type AttemptBinding, type RecoveryContext } from './attempt-recovery-effects'

/** Only this dispatch row supplies the kernel verdict; liveness is not exit proof here. */
export function isRestartTerminalMissing(worker: WorkerDispatchRow | undefined, runtimeId: string) {
  return (
    isHeadlessAttempt(worker) &&
    worker?.state === 'abandoned' &&
    worker.stage === 'terminal_missing' &&
    worker.runtime_epoch !== runtimeId
  )
}

export async function hasAcceptedExitMarker(dispatchId: string): Promise<boolean> {
  // Match submitExitedAttempt exactly. An uncertain read must fail this reconciliation pass.
  const exit = await readHeadlessFile(headlessAttemptDirectory(dispatchId), 'exit-code')
  return exit !== undefined && /^-?\d+\s*$/.test(exit)
}

export function settleRecoveryDaemonLoss(
  ctx: RecoveryContext,
  binding: AttemptBinding & { dispatchId: string },
  worker: WorkerDispatchRow,
  preserved: Awaited<ReturnType<typeof captureRecoveryAttempt>>
) {
  const failure = { class: 'unknown', retryable: true, source: 'absent' } as const
  ctx.store.transaction('recovery_daemon_loss', () => {
    // The kernel already closed this dispatch. Only Axiom settlement remains.
    auditAttempt(ctx, binding, 'attempt.failed', {
      reason: 'terminal_missing',
      lastError: worker.last_error ?? null,
      failure,
      evidence: 'runtime_restarted',
      settlement: { kind: 'interrupted' }
    })
    if (preserved) {
      auditAttempt(ctx, binding, 'attempt.preserved', preserved)
    }
    settleInterruptedAttempt(
      { ...ctx, effects: getAxiomControlPlane(ctx.runtime).effects },
      { ...binding, failure, actor: 'RecoveryService', now: ctx.now() }
    )
  })
}
