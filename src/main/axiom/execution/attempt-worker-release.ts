import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import { getMainE2EConfig } from '../../e2e-config'
import { getAxiomControlPlane } from '../control-plane'
import type { SubmittedAttempt } from './attempt-transcript'

export const WORKER_RELEASE_GRACE_MS = 2_000

export function shouldHoldWorkerRelease(): boolean {
  return getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_WORKER_RELEASE === '1'
}

type FailedAttempt = Pick<SubmittedAttempt, 'missionId' | 'attemptId'>
type ReleaseTarget = FailedAttempt & ({ id: string } | { reason: 'attempt_failed' })

export function scheduleFailedWorkerRelease(runtime: OrcaRuntimeService, attempt: FailedAttempt) {
  scheduleWorkerRelease(runtime, { ...attempt, reason: 'attempt_failed' })
}

export function releaseFailedWorker(runtime: OrcaRuntimeService, attempt: FailedAttempt) {
  return releaseWorker(runtime, { ...attempt, reason: 'attempt_failed' })
}

export function scheduleSubmittedWorkerRelease(
  runtime: OrcaRuntimeService,
  submission: SubmittedAttempt
) {
  scheduleWorkerRelease(runtime, submission)
}

function scheduleWorkerRelease(runtime: OrcaRuntimeService, target: ReleaseTarget) {
  if (shouldHoldWorkerRelease()) {
    return
  }
  // Let the CLI receive its receipt before closing its process tree; recovery covers a lost timer.
  setTimeout(() => {
    void releaseWorker(runtime, target)
  }, WORKER_RELEASE_GRACE_MS).unref()
}

export async function releaseSubmittedWorker(
  runtime: OrcaRuntimeService,
  submission: SubmittedAttempt
) {
  return releaseWorker(runtime, submission)
}

async function releaseWorker(runtime: OrcaRuntimeService, target: ReleaseTarget) {
  if (shouldHoldWorkerRelease()) {
    return
  }
  const { missionId, attemptId } = target
  const details: Record<string, string> =
    'reason' in target ? { reason: target.reason } : { submissionId: target.id }
  const { store } = getAxiomControlPlane(runtime)
  try {
    const { state, processAction, archive } = await releaseLocalWorker(runtime, attemptId)
    store.appendAuditEvent({
      missionId,
      actor: 'AttemptSettlement',
      objectKind: 'attempt',
      objectId: attemptId,
      event: 'attempt.terminal_released',
      before: null,
      after: { ...details, state, processAction, archive }
    })
    return 'terminal_released'
  } catch {
    try {
      store.appendAuditEvent({
        missionId,
        actor: 'AttemptSettlement',
        objectKind: 'attempt',
        objectId: attemptId,
        event: 'attempt.terminal_release_failed',
        before: null,
        after: { reason: 'release_failed', ...details }
      })
    } catch {
      console.warn('[axiom] Worker release audit failed', { attemptId, ...details })
    }
    return 'terminal_release_failed'
  }
}
