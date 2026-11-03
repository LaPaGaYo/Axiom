import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'
import { parseAxiomMessagePayload } from '../../../shared/axiom-contract/message-params'
import { submissionFixture } from './submission-fixture.test-support'
import { answeredQuestions } from '../context-builder/answered-questions'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
})
const submitItems = (questions: string[], followUps: string[] = []) =>
  f.call('axiom.attempt.submit', {
    ...f.params(),
    report: { ...f.params().report, questions, followUps }
  })

it('settles two redacted typed questions and a follow-up with the Submission, once', async () => {
  const secret = `ghp_${'x'.repeat(36)}`
  const response = await submitItems(
    ['Which format?', `Keep ${secret}?`],
    ['Add a regression test']
  )
  expect(response).toMatchObject({ ok: true })
  if (!response.ok) {
    throw new Error('submission failed')
  }
  const { submission } = AttemptSubmitResponseSchema.parse(response.result)
  const items = f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })
  expect(items).toMatchObject([
    { type: 'QUESTION', question: 'Which format?', options: [], answer: null, status: 'pending' },
    { type: 'QUESTION', question: 'Keep [REDACTED]?', options: [], status: 'pending' },
    { type: 'REQUEST', followUp: { text: 'Add a regression test' } }
  ])
  for (const item of items) {
    expect(item).toMatchObject({
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      related: { taskIds: [f.t01.taskId], submissionId: submission.id },
      pending: true
    })
    const message = f.db.getMessageById(item.id)
    expect(message?.from_handle).toBe(f.t01.from)
    expect(parseAxiomMessagePayload(message?.payload ?? null)?.axiom).toMatchObject({
      ...(item.type === 'QUESTION'
        ? { question: { text: item.question, options: [] } }
        : { followUp: item.followUp }),
      summary: item.summary
    })
    expect(message?.payload).not.toContain(secret)
    expect(f.db.getQuestion(item.id)).toBeUndefined()
  }
  const messages = f.store.listMessages({ missionId: f.mission.id })
  expect(messages).toHaveLength(4)
  expect(await submitItems(['Another question?'], ['Another follow-up'])).toMatchObject({
    ok: true
  })
  expect(f.store.listMessages({ missionId: f.mission.id })).toEqual(messages)
  for (const [i, answer] of ['JSON', 'Yes — keep it rejected.'].entries()) {
    expect(
      await f.call('axiom.message.answer', {
        missionId: f.mission.id,
        questionId: items[i].id,
        body: answer
      })
    ).toMatchObject({ ok: true })
  }
  const section = answeredQuestions(f.store, f.mission.id, f.t01.taskId)
  expect(section.content).toBe(
    [
      'Q (Attempt 1): "Keep [REDACTED]?" — A: "Yes — keep it rejected."',
      'Q (Attempt 1): "Which format?" — A: "JSON"'
    ].join('\n')
  )
  console.info(
    'M3-04b-3 observed:',
    JSON.stringify({
      messages: items.map((item) => ({
        ...item,
        payload: parseAxiomMessagePayload(f.db.getMessageById(item.id)?.payload ?? null)
      })),
      audits: f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((e) => e.event === 'question.answered'),
      section
    })
  )
})

it('routes only the first ten of each list and audits omitted counts once', async () => {
  expect(
    await submitItems(
      Array.from({ length: 12 }, (_, i) => `Question ${i}?`),
      Array.from({ length: 11 }, (_, i) => `Follow-up ${i}`)
    )
  ).toMatchObject({ ok: true })
  const items = f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })
  expect(items.filter((m) => m.type === 'QUESTION')).toHaveLength(10)
  expect(items.filter((m) => m.type === 'REQUEST')).toHaveLength(10)
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'submission.items_truncated')
  ).toEqual([
    expect.objectContaining({ objectKind: 'submission', after: { questions: 2, followUps: 1 } })
  ])
})

it('rolls back items and audits without notifications when settlement loses authority', async () => {
  f.snapshotGit.mockImplementationOnce(async () => {
    f.db.settleWorkerReport({
      taskId: f.t01.taskId,
      dispatchId: f.t01.attemptId,
      outcome: 'failed',
      result: 'lost race'
    })
    return { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), snapshotCommitted: false }
  })
  expect(await submitItems(['Question?'], ['Follow-up'])).toMatchObject({ ok: false })
  expect(f.store.listMessages({ missionId: f.mission.id })).toEqual([])
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => ['message.sent', 'submission.items_truncated'].includes(e.event))
  ).toEqual([])
  expect(f.notify).not.toHaveBeenCalled()
})
