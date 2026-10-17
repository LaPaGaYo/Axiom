import type { z } from 'zod'
import type { AttemptAskParams } from '../../../shared/axiom-contract/attempt-params'
import { clampOrchestrationAskTimeoutMs } from '../../../shared/orchestration-ask-timeout'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { MessageRow } from '../../runtime/orchestration/types'
import type { RpcContext } from '../../runtime/rpc/core'
import { getAxiomControlPlane } from '../control-plane'
import { resolveAttemptSender } from './attempt-authority'

export async function askAttempt(p: z.infer<typeof AttemptAskParams>, ctx: RpcContext) {
  const { runtime, signal, recordMutationReceipt } = ctx
  const db = runtime.getOrchestrationDb()
  const { store } = getAxiomControlPlane(runtime)
  const { dispatch, run, sender, mission, task } = resolveAttemptSender({
    runtime,
    db,
    store,
    ...p,
    orchestrationCaller: ctx.orchestrationCaller,
    orchestrationCapability: ctx.orchestrationCapability
  })
  let question = p.resume ? db.getQuestion(p.resume) : undefined
  let notification: MessageRow['type'] | undefined
  if (p.resume) {
    if (!question || question.dispatch_id !== dispatch.id || question.run_id !== run.id) {
      throw new OrchestrationError(
        'question_not_found',
        'Question does not belong to this Attempt.'
      )
    }
  } else {
    if (!p.question) {
      throw new OrchestrationError('invalid_argument', 'Question is required.')
    }
    const created = db.createQuestion({
      runId: run.id,
      dispatchId: dispatch.id,
      askerHandle: sender.address,
      question: p.question,
      options: p.options
    })
    question = created.question
    // createQuestion already routes its own message to the Control Plane mailbox.
    notification = created.message.type
  }
  if (!question) {
    throw new OrchestrationError('question_not_found', 'Question was not found.')
  }
  const questionId = question.message_id
  const timeoutMs = clampOrchestrationAskTimeoutMs(p.timeoutMs)
  const receipt = {
    answer: null,
    messageId: questionId,
    threadId: questionId,
    timedOut: false,
    cancelled: false,
    connectionLost: false,
    timeoutMs
  }
  store.transaction('question_receipt', () => {
    if (!p.resume) {
      store.appendAuditEvent({
        missionId: mission.id,
        actor: sender.address,
        objectKind: 'message',
        objectId: questionId,
        event: 'question.created',
        before: null,
        after: { type: 'QUESTION', taskId: task.taskId, attemptId: dispatch.id }
      })
    }
    recordMutationReceipt?.({ ...receipt, accepted: true })
  })
  if (notification) {
    runtime.notifyMessageArrived(`run:${run.id}`, notification)
  }
  const deadline = Date.now() + timeoutMs
  while (true) {
    const current = db.getQuestion(questionId)
    if (!current || current.status === 'closed') {
      throw new OrchestrationError(
        'dispatch_inactive',
        'Question closed because its Dispatch is inactive.'
      )
    }
    if (current.status === 'answered') {
      return { ...receipt, answer: current.answer_body, answerMessageId: current.answer_message_id }
    }
    if (signal?.aborted) {
      return { ...receipt, cancelled: true, connectionLost: true }
    }
    const remainingMs = deadline - Date.now()
    if (remainingMs <= 0) {
      return { ...receipt, timedOut: true }
    }
    await runtime.waitForMessage(`dispatch:${dispatch.id}`, { timeoutMs: remainingMs, signal })
  }
}
