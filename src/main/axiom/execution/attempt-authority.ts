import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/orchestration-caller-identity'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { hasLifecycleAuthority } from '../../runtime/orchestration/lifecycle-reconciliation'
import { orchestrationCallerIdentity } from '../../runtime/rpc/methods/orchestration/runs/run-scope'
import { workerReportRefusal } from '../../runtime/orchestration/worker-report-admission'
import { assertLifecycleCallerIsNotAnotherParty } from '../../runtime/rpc/methods/orchestration/messaging/lifecycle-caller-fence'
import type { AxiomStore } from '../db/axiom-store'

type SenderInput = {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  store: AxiomStore
  from: string
  attemptId: string
  orchestrationCaller?: OrchestrationSessionCaller
  orchestrationCompatibilityEvidence?: OrchestrationCompatibilityEvidence
  allowSubmissionReplay?: boolean
}

export function resolveAttemptSender(
  input: SenderInput & { role: 'planner' }
): ReturnType<typeof resolveAttemptIdentity>
export function resolveAttemptSender(
  input: SenderInput & { role?: 'worker' }
): ReturnType<typeof resolveWorkerSender>
export function resolveAttemptSender(input: SenderInput & { role?: 'planner' | 'worker' }) {
  const identity = resolveAttemptIdentity(input)
  if (input.role === 'planner') {
    const spec = input.store.getAgentSpec(identity.binding.agentSpecId)?.spec
    if (
      !identity.binding.branch.startsWith(`axiom/planner/${identity.mission.id}/`) ||
      spec?.role !== 'planner' ||
      spec.missionId !== identity.mission.id ||
      input.store.getTaskStage(identity.binding.taskId)
    ) {
      throw new OrchestrationError('task_dispatch_mismatch', 'Attempt is not a Planner binding.')
    }
    return identity
  }
  return resolveWorkerSender(input, identity)
}

function resolveWorkerSender(
  input: SenderInput,
  identity: ReturnType<typeof resolveAttemptIdentity>
) {
  const task = input.store.getTaskStage(identity.binding.taskId)
  if (!task || task.missionId !== identity.mission.id) {
    throw new OrchestrationError('task_dispatch_mismatch', 'Attempt has no Mission Task stage.')
  }
  return { ...identity, task }
}

export function resolveAttemptIdentity(input: SenderInput) {
  const { runtime, db, store, from, attemptId, orchestrationCaller } = input
  const sender = orchestrationCallerIdentity(runtime, {
    handle: from,
    paneKey: runtime.getTerminalPaneKey(from),
    session: orchestrationCaller
  })
  if (!orchestrationCaller) {
    assertLifecycleCallerIsNotAnotherParty(runtime, {
      from,
      fromPaneKey: sender.paneKey ?? undefined,
      evidence: input.orchestrationCompatibilityEvidence
    })
  }
  const dispatch = db.getDispatchContextById(attemptId)
  if (!dispatch) {
    throw new OrchestrationError('unknown_dispatch', 'Attempt dispatch was not found.')
  }
  const binding = store.getAttemptBindingByDispatch(attemptId)
  if (!binding) {
    throw new OrchestrationError('unknown_dispatch', 'Attempt binding was not found.')
  }
  // Settlement revokes mutation authority. A saved Submission permits only an authenticated
  // read of that immutable result; it never reactivates the dispatch.
  const replay =
    input.allowSubmissionReplay && dispatch.status === 'completed'
      ? store.getSubmissionByDispatch(attemptId)
      : undefined
  if (dispatch.status !== 'dispatched' && !replay) {
    throw new OrchestrationError('inactive_dispatch', 'Attempt is not dispatched.')
  }
  if (store.nextAttemptSeq(binding.taskId) > binding.seq + 1) {
    throw new OrchestrationError('stale_dispatch', 'A newer Attempt owns this Task.')
  }
  const processIdentity = {
    dispatchId: attemptId,
    paneKey: sender.paneKey ?? null,
    processIncarnation: runtime.getTerminalProcessIncarnation(from) ?? null
  }
  if (replay) {
    verifySubmissionReplay(db, processIdentity)
  } else {
    const refusal = workerReportRefusal({
      dispatchId: attemptId,
      from,
      workerState: db.getWorkerDispatch(attemptId)?.state,
      processCurrent: !dispatch.process_incarnation || db.isDispatchProcessCurrent(processIdentity)
    })
    if (refusal) {
      throw new OrchestrationError(refusal.code, refusal.reason)
    }
    if (
      !dispatch.process_incarnation &&
      !db.isDispatchMessageSender({
        dispatchId: attemptId,
        handle: sender.address,
        paneKey: sender.paneKey
      })
    ) {
      throw new OrchestrationError('sender_not_assignee', 'Sender is not the Attempt assignee.')
    }
  }
  if (
    !hasLifecycleAuthority(dispatch, {
      from_handle: sender.address,
      sender_pane_key: sender.paneKey
    })
  ) {
    throw new OrchestrationError('sender_not_assignee', 'Sender is not the Attempt assignee.')
  }
  const mission = store.getMission(binding.missionId)
  const task = db.getTask(binding.taskId)
  const run = db.getRun(dispatch.run_id)
  if (
    !mission ||
    !task ||
    !run ||
    task.id !== dispatch.task_id ||
    task.run_id !== mission.runId ||
    mission.runId !== run.id
  ) {
    throw new OrchestrationError(
      'task_dispatch_mismatch',
      'Attempt, Task and Mission Run do not match.'
    )
  }
  return { mission, binding, dispatch, run, sender }
}
function verifySubmissionReplay(
  db: OrchestrationDb,
  identity: Parameters<OrchestrationDb['isDispatchProcessCurrent']>[0]
) {
  if (!db.isDispatchProcessCurrent(identity)) {
    throw new OrchestrationError(
      'worker_identity_changed',
      'Submission replay requires the original Dispatch pane and process.'
    )
  }
}
