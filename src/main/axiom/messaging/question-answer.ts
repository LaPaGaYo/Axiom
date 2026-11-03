import type { z } from 'zod'
import type { MessageAnswerParams } from '../../../shared/axiom-contract/message-params'
import type { RpcContext } from '../../runtime/rpc/core'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { getAxiomControlPlane } from '../control-plane'
import { parseAxiomMessagePayload } from '../../../shared/axiom-contract/message-params'
import { redactContext } from '../context-builder/redaction'

export function answerMissionQuestion(p: z.infer<typeof MessageAnswerParams>, ctx: RpcContext) {
  const { runtime, recordMutationReceipt } = ctx
  const db = runtime.getOrchestrationDb()
  const { missions, store } = getAxiomControlPlane(runtime)
  const mission = missions.getMission(p.missionId)
  const message = db.getMessageById(p.questionId)
  const axiom = message && parseAxiomMessagePayload(message.payload)?.axiom
  if (axiom?.type === 'QUESTION' && axiom.question) {
    if (
      message?.run_id !== mission.runId ||
      message.to_handle !== `run:${mission.runId}` ||
      axiom.missionId !== mission.id ||
      store.getTaskStage(axiom.taskId)?.missionId !== mission.id
    ) {
      throw new OrchestrationError(
        'question_not_found',
        'Question does not belong to this Mission.'
      )
    }
    return store.transaction('question_answer_receipt', () => {
      const pending = store
        .listMessages({ missionId: mission.id, type: 'QUESTION', pendingOnly: true })
        .some((item) => item.id === p.questionId)
      if (!pending) {
        throw new OrchestrationError('invalid_argument', 'Question is already answered.')
      }
      scanAnswer(p.body)
      if (p.body.length > 4000) {
        throw new OrchestrationError('invalid_argument', 'Answer exceeds 4,000 characters.')
      }
      store.appendAuditEvent({
        missionId: mission.id,
        actor: 'user',
        objectKind: 'message',
        objectId: p.questionId,
        event: 'question.answered',
        before: { status: 'pending' },
        after: {
          status: 'answered',
          taskId: axiom.taskId,
          attemptId: axiom.attemptId,
          answer: p.body,
          by: 'user'
        }
      })
      // A retry may already be READY; answering changes admission without changing its stage.
      missions.recomputeReadiness(mission.id, true)
      const result = { questionId: p.questionId, status: 'answered' as const }
      recordMutationReceipt?.(result)
      return result
    })
  }
  const question = db.getQuestion(p.questionId)
  const binding = question && store.getAttemptBindingByDispatch(question.dispatch_id)
  if (!question || question.run_id !== mission.runId || binding?.missionId !== mission.id) {
    throw new OrchestrationError('question_not_found', 'Question does not belong to this Mission.')
  }
  const run = db.getRun(mission.runId)
  if (!run) {
    throw new OrchestrationError('run_not_found', 'Mission Run was not found.')
  }
  scanAnswer(p.body)
  // The kernel method owns its BEGIN IMMEDIATE; do not wrap it in another transaction.
  const answered = db.answerQuestion({
    messageId: p.questionId,
    runId: run.id,
    consumerGeneration: run.consumer_generation,
    body: p.body
  })
  store.transaction('question_answer_receipt', () => {
    const recorded = store
      .listAuditEvents({ missionId: mission.id })
      .some(
        (e) =>
          e.event === 'question.answered' &&
          e.objectKind === 'message' &&
          e.objectId === p.questionId
      )
    if (!recorded) {
      store.appendAuditEvent({
        missionId: mission.id,
        actor: 'user',
        objectKind: 'message',
        objectId: p.questionId,
        event: 'question.answered',
        before: { status: 'pending' },
        after: {
          status: 'answered',
          answerMessageId: answered.message.id,
          taskId: binding.taskId,
          attemptId: question.dispatch_id
        }
      })
    }
    missions.recomputeReadiness(mission.id)
    recordMutationReceipt?.(answered)
  })
  runtime.notifyMessageArrived(`dispatch:${question.dispatch_id}`, 'status')
  return answered
}

function scanAnswer(body: string): void {
  if (redactContext(body).redacted) {
    throw new OrchestrationError('invalid_argument', 'secret_in_answer')
  }
}
