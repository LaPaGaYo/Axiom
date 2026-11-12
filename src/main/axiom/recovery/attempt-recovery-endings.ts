import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import { settleInterruptedAttempt } from '../execution/attempt-interruption'
import { getAxiomControlPlane } from '../control-plane'
import type { captureRecoveryAttempt } from './attempt-recovery-preservation'
import { settleSupervisionStop } from './supervision-stop-settlement'
import {
  auditAttempt,
  lastAttemptAudit,
  type AttemptBinding,
  type RecoveryContext
} from './attempt-recovery-effects'

type Preservation = Awaited<ReturnType<typeof captureRecoveryAttempt>>

function recordPreservation(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  preserved: Preservation
) {
  if (preserved) {
    auditAttempt(ctx, binding, 'attempt.preserved', preserved)
  }
}
function settle(ctx: RecoveryContext, binding: AttemptBinding, reason: string) {
  return settleAttemptWithoutSubmission(ctx, { ...binding, reason, actor: 'RecoveryService' })
}

export function settleRecoveryTerminal(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  worker: WorkerDispatchRow,
  reason: string,
  failureReason: 'kernel_failed',
  preserved: Preservation
) {
  ctx.store.transaction('recovery_terminal', () => {
    if (worker.state === 'failed' && !lastAttemptAudit(ctx, binding, 'attempt.failed')) {
      auditAttempt(ctx, binding, 'attempt.failed', {
        reason: failureReason,
        lastError: worker.last_error ?? null
      })
    }
    if (worker.state === 'stopped') {
      auditAttempt(ctx, binding, 'attempt.stopped', { reason: 'kernel_stopped' })
    }
    recordPreservation(ctx, binding, preserved)
    // Reattach evidence after a crash between kernel abandonment and Axiom settlement.
    const evidence =
      worker.state === 'abandoned'
        ? ctx.store
            .listArtifacts({
              missionId: binding.missionId,
              relatedTo: binding.dispatchId ?? undefined,
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
    settle(ctx, binding, evidence ? 'unverifiable_tolerance_exceeded' : reason)
  })
}

export function settleRecoveryProcessExit(
  ctx: RecoveryContext,
  binding: AttemptBinding & { dispatchId: string },
  worker: WorkerDispatchRow,
  headless: boolean,
  evidence: string | undefined,
  preserved: Preservation
) {
  const failure =
    headless && worker.runtime_epoch !== ctx.runtime.getRuntimeId()
      ? ({ class: 'unknown', retryable: true, source: 'absent' } as const)
      : undefined
  ctx.store.transaction('recovery_process_exit', () => {
    // failDispatch owns a savepoint and is safe inside the Axiom transaction.
    ctx.db.failDispatch(
      binding.dispatchId,
      evidence
        ? 'Worker agent exited without a Submission'
        : 'Worker process exited without a Submission',
      { workerProcessExited: true, terminationReason: 'process_exited' }
    )
    auditAttempt(ctx, binding, 'attempt.failed', {
      reason: 'process_exited',
      ...(evidence ? { evidence } : {}),
      ...(failure
        ? { failure, evidence: 'runtime_restarted', settlement: { kind: 'interrupted' } }
        : headless
          ? { settlement: { kind: 'failed' } }
          : {})
    })
    recordPreservation(ctx, binding, preserved)
    if (failure) {
      settleInterruptedAttempt(
        { ...ctx, effects: getAxiomControlPlane(ctx.runtime).effects },
        {
          ...binding,
          failure,
          actor: 'RecoveryService',
          now: ctx.now()
        }
      )
    } else {
      settle(ctx, binding, 'attempt_failed')
    }
  })
  return failure ? 'interrupted' : 'failed'
}

export function settleRecoveryBudget(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  state: string,
  supervision: { thresholdMs: number; thresholdSource: 'task' | 'policy'; elapsedMs: number },
  preserved: Preservation
) {
  settleSupervisionStop(
    ctx,
    binding,
    state,
    { rule: 'timeout', mode: 'auto', ...supervision },
    preserved,
    'recovery_runtime_budget'
  )
}
