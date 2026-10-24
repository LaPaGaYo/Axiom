import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import { getMainE2EConfig } from '../../e2e-config'
import { getAxiomControlPlane } from '../control-plane'
import type { SubmittedAttempt } from './attempt-transcript'

export const WORKER_RELEASE_GRACE_MS = 2_000

export function shouldHoldWorkerRelease(): boolean {
  return getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_WORKER_RELEASE === '1'
}

export function scheduleSubmittedWorkerRelease(
  runtime: OrcaRuntimeService,
  submission: SubmittedAttempt
) {
  if (shouldHoldWorkerRelease()) {
    return
  }
  // Let the CLI receive its receipt before closing its process tree; recovery covers a lost timer.
  setTimeout(() => {
    void releaseSubmittedWorker(runtime, submission)
  }, WORKER_RELEASE_GRACE_MS).unref()
}

export async function releaseSubmittedWorker(
  runtime: OrcaRuntimeService,
  submission: SubmittedAttempt
) {
  if (shouldHoldWorkerRelease()) {
    return
  }
  const { missionId, attemptId, id: submissionId } = submission
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
      after: { submissionId, state, processAction, archive }
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
        after: { submissionId, reason: 'release_failed' }
      })
    } catch {
      console.warn('[axiom] Worker release audit failed', { attemptId, submissionId })
    }
    return 'terminal_release_failed'
  }
}
