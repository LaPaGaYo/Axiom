import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { getAxiomControlPlane } from '../control-plane'
import { redactContext } from '../context-builder/redaction'
import { resolveHostAttempt } from './attempt-authority'
import { settleAttemptWithoutSubmission } from './attempt-settlement'
import { settleInterruptedAttempt } from './attempt-interruption'
import { scheduleFailedWorkerRelease } from './attempt-worker-release'
import { classifyHeadlessFailure } from './attempt-failure-classification'
import { readAttemptAccount } from './attempt-account'
import type { parseHeadlessWorkerEvents } from './headless-worker-events'

export function settleHeadlessExitFailure(
  runtime: OrcaRuntimeService,
  input: {
    attemptId: string
    provider: string
    eventsText: string
    events: ReturnType<typeof parseHeadlessWorkerEvents>
    exitCode: number
    lastMessage: string
    reportError?: string
    eventAudit: Record<string, unknown>
  }
) {
  const { attemptId, events, exitCode, lastMessage, reportError, eventAudit } = input
  const db = runtime.getOrchestrationDb()
  const { store, missions, effects } = getAxiomControlPlane(runtime)
  const now = Date.now()
  const { kind, failure } = classifyHeadlessFailure({
    eventsText: input.eventsText,
    provider: input.provider,
    now
  })
  const missionId = store.transaction('headless_exit_failure', () => {
    const authority = resolveHostAttempt(db, store, attemptId)
    db.failDispatch(attemptId, 'Headless Worker exited without a valid Submission', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    store.appendAuditEvent({
      missionId: authority.mission.id,
      actor: 'AttemptSettlement',
      event: 'attempt.failed',
      objectKind: 'attempt',
      objectId: attemptId,
      before: null,
      after: {
        taskId: authority.task.taskId,
        reason: 'process_exited',
        evidence: 'exit_code',
        exitCode,
        settlement: { kind },
        failure,
        lastError: redactContext(events.lastError ?? '').content.slice(-2000),
        ...(events.lastErrorEvent
          ? {
              lastErrorEvent: {
                type: events.lastErrorEvent.type,
                message: redactContext(events.lastErrorEvent.message).content.slice(-2000)
              }
            }
          : {}),
        lastMessageExcerpt: redactContext(lastMessage).content.slice(-2000),
        ...(reportError ? { reportError } : {}),
        ...eventAudit
      }
    })
    const settlement = { ...authority.binding, dispatchId: attemptId, actor: 'AttemptSettlement' }
    if (kind === 'interrupted') {
      settleInterruptedAttempt(
        { store, missions, db, runtime, effects },
        {
          ...settlement,
          failure,
          now,
          account:
            failure.class === 'usage_limit'
              ? readAttemptAccount(store, authority.mission.id, attemptId, input.provider)
              : undefined
        }
      )
    } else {
      settleAttemptWithoutSubmission(
        { store, missions },
        { ...settlement, reason: 'attempt_failed' }
      )
    }
    return authority.mission.id
  })
  scheduleFailedWorkerRelease(runtime, { missionId, attemptId })
  return kind
}
