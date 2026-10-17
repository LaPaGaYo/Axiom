import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { MessageRow } from '../../runtime/orchestration/types'
import type { OrchestrationCallerIdentity } from '../../runtime/orchestration/orchestration-caller-identity'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  AxiomMessagePayloadSchema,
  axiomMessageRoutingType,
  type AxiomMessagePayload
} from '../../../shared/axiom-contract/message-params'
import type { AxiomStore } from '../db/axiom-store'

export function routeWorkerMessage(
  ctx: {
    runtime: Pick<OrcaRuntimeService, 'notifyMessageArrived'>
    db: OrchestrationDb
    store: AxiomStore
    recordMutationReceipt?: (receipt: unknown) => void
  },
  input: AxiomMessagePayload & { sender: OrchestrationCallerIdentity; body?: string }
) {
  const { runtime, db, store } = ctx
  const { axiom } = AxiomMessagePayloadSchema.parse({ axiom: input.axiom })
  const type = axiomMessageRoutingType(axiom.type)
  const receipt = store.transaction('message_route', () => {
    const mission = store.getMission(axiom.missionId)
    if (!mission) {
      throw new OrchestrationError('invalid_argument', 'Unknown message Mission.')
    }
    for (const artifactId of [
      ...axiom.artifactIds,
      ...(axiom.related.artifactId ? [axiom.related.artifactId] : [])
    ]) {
      if (store.getArtifact(artifactId)?.missionId !== mission.id) {
        throw new OrchestrationError(
          'invalid_argument',
          'Artifact must belong to the message Mission.'
        )
      }
    }
    const relatedTasks = axiom.related.taskIds ?? []
    for (const taskId of relatedTasks) {
      if (store.getTaskStage(taskId)?.missionId !== mission.id) {
        throw new OrchestrationError(
          'invalid_argument',
          'Related Task must belong to the message Mission.'
        )
      }
    }
    // The deterministic consumer reads run:<id>; a coordinator session address is direct mail.
    const recipients = new Set([`run:${mission.runId}`])
    if (axiom.type === 'INFORM' || axiom.type === 'HANDOFF') {
      const taskIds = relatedTasks.length
        ? relatedTasks
        : store.listDownstreamEdges(axiom.taskId).map((e) => e.toTaskId)
      for (const taskId of new Set(taskIds)) {
        const bindings = store.listAttemptBindings({ missionId: mission.id, taskId })
        const latest = bindings.at(-1)
        const dispatch = latest?.dispatchId
          ? db.getDispatchContextById(latest.dispatchId)
          : undefined
        if (
          dispatch?.status === 'dispatched' &&
          dispatch.run_id === mission.runId &&
          dispatch.task_id === taskId
        ) {
          recipients.add(`dispatch:${dispatch.id}`)
        }
      }
    }
    const messages: MessageRow[] = []
    for (const to of recipients) {
      messages.push(
        db.insertMessage({
          from: input.sender.address,
          to,
          subject: axiom.summary,
          body: input.body,
          type,
          payload: JSON.stringify({ axiom }),
          senderPaneKey: input.sender.paneKey ?? undefined,
          runId: mission.runId,
          threadId: messages[0]?.id
        })
      )
    }
    const message = messages[0]!
    store.appendAuditEvent({
      missionId: mission.id,
      actor: input.sender.address,
      objectKind: 'message',
      objectId: message.id,
      event: 'message.sent',
      before: null,
      after: {
        type: axiom.type,
        taskId: axiom.taskId,
        attemptId: axiom.attemptId,
        recipients: [...recipients]
      }
    })
    const result = {
      message: {
        id: message.id,
        type: axiom.type,
        taskId: axiom.taskId,
        attemptId: axiom.attemptId,
        summary: axiom.summary,
        artifactIds: axiom.artifactIds,
        related: axiom.related,
        ...(axiom.subtask ? { subtask: axiom.subtask } : {}),
        createdAt: message.created_at,
        pending: axiom.type === 'REQUEST_SUBTASK'
      },
      recipients: [...recipients]
    }
    // Commit the kernel receipt with mail, before notifications can fail or trigger consumers.
    ctx.recordMutationReceipt?.(result)
    return result
  })
  for (const recipient of receipt.recipients) {
    runtime.notifyMessageArrived(recipient, type)
  }
  return receipt
}
