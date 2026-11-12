import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { getAxiomControlPlane } from '../control-plane'
import { redactContext } from '../context-builder/redaction'
import { resolveHostAttempt } from './attempt-authority'
import { settleAttemptWithoutSubmission } from './attempt-settlement'
import { settleInterruptedAttempt } from './attempt-interruption'
import { scheduleFailedWorkerRelease } from './attempt-worker-release'
import { classifyHeadlessFailure } from './attempt-failure-classification'
import { readAttemptAccount } from './attempt-account'
import { readCodexRolloutLimit } from './codex-rollout-limit'
import { INTERRUPTION_MAX_RESET_MS } from './interruption-policy'
import { sessionOriginStartedAt } from './in-place-session'
import type { parseHeadlessWorkerEvents } from './headless-worker-events'
import { collectAttemptPreservation } from './attempt-preservation'
import type { PreservationInput } from './preserved-snapshot'

export async function settleHeadlessExitFailure(
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
    resumeRefused?: boolean
    launch: PreservationInput['launch']
  }
) {
  const { attemptId, events, exitCode, lastMessage, reportError, eventAudit } = input
  const db = runtime.getOrchestrationDb()
  const { store, missions, effects, artifacts } = getAxiomControlPlane(runtime)
  const now = Date.now()
  const classified = input.resumeRefused
    ? {
        kind: 'interrupted' as const,
        failure: { class: 'unknown' as const, retryable: true, source: 'absent' as const }
      }
    : classifyHeadlessFailure({
        eventsText: input.eventsText,
        provider: input.provider,
        now
      })
  const { kind } = classified
  let failure = classified.failure
  const binding = store.getAttemptBindingByDispatch(attemptId)
  const launchAccount =
    failure.class === 'usage_limit' && binding
      ? readAttemptAccount(store, binding.missionId, attemptId, input.provider)
      : undefined
  if (input.provider === 'codex' && failure.class === 'usage_limit') {
    const limit = await readCodexRolloutLimit({
      accountHome: launchAccount?.home,
      threadId: events.providerSessionId,
      startedAt: binding ? sessionOriginStartedAt(db, store, binding) : Number.NaN,
      now: () => now
    })
    const reset = limit?.resetsAt
    failure = {
      ...failure,
      ...(limit?.window ? { window: limit.window } : {}),
      ...(reset !== undefined && now < reset && reset <= now + INTERRUPTION_MAX_RESET_MS
        ? { resetsAt: new Date(reset).toISOString() }
        : {})
    }
  }
  const captureAuthority = resolveHostAttempt(db, store, attemptId)
  const preservation = await collectAttemptPreservation(artifacts, {
    attemptId,
    taskId: captureAuthority.task.taskId,
    seq: captureAuthority.binding.seq,
    missionId: captureAuthority.mission.id,
    launch: input.launch,
    allowedPaths: captureAuthority.task.spec.scope.allowedPaths,
    verificationRules: store.getPolicy(captureAuthority.mission.id)?.verificationRules,
    provider: input.provider,
    eventsText: input.eventsText
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
        reason: input.resumeRefused ? 'resume_refused' : 'process_exited',
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
    store.appendAuditEvent({
      missionId: authority.mission.id,
      actor: 'AttemptSettlement',
      event: 'attempt.preserved',
      objectKind: 'attempt',
      objectId: attemptId,
      before: null,
      after: preservation
    })
    const settlement = { ...authority.binding, dispatchId: attemptId, actor: 'AttemptSettlement' }
    if (kind === 'interrupted') {
      settleInterruptedAttempt(
        { store, missions, db, runtime, effects },
        {
          ...settlement,
          failure,
          now,
          account: launchAccount?.account,
          resumeRefused: input.resumeRefused
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
