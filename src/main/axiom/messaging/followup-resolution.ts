import type { z } from 'zod'
import {
  type MessageResolveParams,
  parseAxiomMessagePayload
} from '../../../shared/axiom-contract/message-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { redactContext } from '../context-builder/redaction'
import { resolveSubtask } from './subtask-resolution'

export function resolveMissionMessage(
  ctx: Parameters<typeof resolveSubtask>[0],
  p: z.infer<typeof MessageResolveParams>
) {
  const { db, store, missions } = ctx
  const message = db.getMessageById(p.messageId)
  const axiom = message && parseAxiomMessagePayload(message.payload)?.axiom
  if (axiom?.type !== 'REQUEST' || !axiom.followUp) {
    return resolveSubtask(ctx, p)
  }
  return store.transaction('followup_resolution', () => {
    const mission = missions.getMission(p.missionId)
    const pending = store
      .listMessages({ missionId: mission.id, type: 'REQUEST', pendingOnly: true })
      .some((item) => item.id === p.messageId)
    if (
      message?.run_id !== mission.runId ||
      message.to_handle !== `run:${mission.runId}` ||
      axiom.missionId !== mission.id ||
      !pending
    ) {
      throw new OrchestrationError(
        'invalid_argument',
        'Message is not a pending follow-up in this Mission.'
      )
    }
    const after = {
      decision: p.decision,
      rationale: redactContext(p.rationale).content,
      taskId: axiom.taskId,
      attemptId: axiom.attemptId
    }
    store.appendAuditEvent({
      missionId: mission.id,
      actor: 'user',
      objectKind: 'message',
      objectId: p.messageId,
      event: 'followup.resolved',
      before: null,
      after
    })
    // Acceptance records intent only. Task creation remains a separate desktop command.
    return { resolved: true as const, ...after }
  })
}
