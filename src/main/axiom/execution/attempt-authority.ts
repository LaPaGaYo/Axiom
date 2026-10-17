import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { OrchestrationSessionCaller } from '../../runtime/orchestration/orchestration-caller-identity'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { hasLifecycleAuthority } from '../../runtime/orchestration/lifecycle-reconciliation'
import { orchestrationCallerIdentity } from '../../runtime/rpc/methods/orchestration/runs/run-scope'
import type { AxiomStore } from '../db/axiom-store'

export function resolveAttemptSender(input: {
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  store: AxiomStore
  from: string
  attemptId: string
  orchestrationCaller?: OrchestrationSessionCaller
  orchestrationCapability?: string
}) {
  const { runtime, db, store, from, attemptId, orchestrationCaller, orchestrationCapability } =
    input
  const dispatch = db.getDispatchContextById(attemptId)
  if (!dispatch) {
    throw new OrchestrationError('unknown_dispatch', 'Attempt dispatch was not found.')
  }
  const binding = store.getAttemptBindingByDispatch(attemptId)
  if (!binding) {
    throw new OrchestrationError('unknown_dispatch', 'Attempt binding was not found.')
  }
  if (dispatch.status !== 'dispatched') {
    throw new OrchestrationError('inactive_dispatch', 'Attempt is not dispatched.')
  }
  if (store.nextAttemptSeq(binding.taskId) > binding.seq + 1) {
    throw new OrchestrationError('stale_dispatch', 'A newer Attempt owns this Task.')
  }
  const sender = orchestrationCallerIdentity(runtime, {
    handle: from,
    paneKey: runtime.getTerminalPaneKey(from),
    session: orchestrationCaller
  })
  const authority = db.verifyDispatchCapability({
    dispatchId: attemptId,
    capability: orchestrationCapability,
    paneKey: sender.paneKey ?? undefined,
    processIncarnation: runtime.getTerminalProcessIncarnation(from) ?? undefined
  })
  if (!authority.valid) {
    throw new OrchestrationError('dispatch_capability_invalid', authority.reason)
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
  const task = store.getTaskStage(binding.taskId)
  const run = db.getRun(dispatch.run_id)
  if (
    !mission ||
    !task ||
    !run ||
    task.taskId !== dispatch.task_id ||
    task.missionId !== mission.id ||
    mission.runId !== run.id
  ) {
    throw new OrchestrationError(
      'task_dispatch_mismatch',
      'Attempt, Task and Mission Run do not match.'
    )
  }
  return { mission, task, binding, dispatch, run, sender }
}
