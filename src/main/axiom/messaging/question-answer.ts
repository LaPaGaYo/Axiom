import type { z } from 'zod'
import type { MessageAnswerParams } from '../../../shared/axiom-contract/message-params'
import type { RpcContext } from '../../runtime/rpc/core'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { getAxiomControlPlane } from '../control-plane'

export function answerMissionQuestion(p: z.infer<typeof MessageAnswerParams>, ctx: RpcContext) {
  const { runtime, recordMutationReceipt } = ctx
  const db = runtime.getOrchestrationDb()
  const { missions, store } = getAxiomControlPlane(runtime)
  const mission = missions.getMission(p.missionId)
  const question = db.getQuestion(p.questionId)
  const binding = question && store.getAttemptBindingByDispatch(question.dispatch_id)
  if (!question || question.run_id !== mission.runId || binding?.missionId !== mission.id) {
    throw new OrchestrationError('question_not_found', 'Question does not belong to this Mission.')
  }
  const run = db.getRun(mission.runId)
  if (!run) {
    throw new OrchestrationError('run_not_found', 'Mission Run was not found.')
  }
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
