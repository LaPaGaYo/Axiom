import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { resolveAttemptSender } from '../execution/attempt-authority'
import { routeWorkerMessage } from './message-router'

export function reportItemsFixture() {
  const f = channelFixture()
  const { sender } = resolveAttemptSender({ ...f, ...f.t01 })
  function item(type: 'QUESTION' | 'REQUEST', text: string, options: string[] = []) {
    return routeWorkerMessage(f, {
      sender,
      axiom: {
        version: 1,
        type,
        missionId: f.mission.id,
        taskId: f.t01.taskId,
        attemptId: f.t01.attemptId,
        summary: text,
        artifactIds: [],
        related: { taskIds: [f.t01.taskId], submissionId: 'submission-fixture' },
        ...(type === 'QUESTION' ? { question: { text, options } } : { followUp: { text } })
      }
    }).message.id
  }
  const answer = (questionId: string, body: string, requestId?: string) =>
    f.call(
      'axiom.message.answer',
      { missionId: f.mission.id, questionId, body },
      requestId ? { orchestrationRequestId: requestId } : {}
    )
  return { ...f, item, answer }
}
