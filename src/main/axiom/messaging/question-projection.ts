import { z } from 'zod'
import type { OrchestrationDb } from '../../runtime/orchestration/db'

const Payload = z.object({ question: z.string(), options: z.array(z.string()).default([]) })
export function projectQuestion(db: OrchestrationDb, messageId: string) {
  const question = db.getQuestion(messageId)
  const message = db.getMessageById(messageId)
  if (!question || message?.type !== 'question' || message.run_id !== question.run_id) {
    return undefined
  }
  const dispatch = db.getDispatchContextById(question.dispatch_id)
  if (!dispatch || dispatch.run_id !== question.run_id || !dispatch.task_id) {
    return undefined
  }
  let content: z.infer<typeof Payload>
  try {
    content = Payload.parse(JSON.parse(message.payload ?? '{}'))
  } catch {
    return undefined
  }
  return {
    type: 'QUESTION' as const,
    taskId: dispatch.task_id,
    attemptId: dispatch.id,
    summary: content.question,
    artifactIds: [],
    related: {},
    question: content.question,
    options: content.options,
    answer: question.answer_body,
    status: question.status,
    pending: question.status === 'pending'
  }
}
