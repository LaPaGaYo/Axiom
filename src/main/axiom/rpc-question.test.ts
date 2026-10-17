import { blockingQuestionOrApproval } from './scheduler/admission-blockers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { channelFixture } from './execution/attempt-channel-fixture.test-support'
import { RunMailboxConsumer } from './mission-controller/run-mailbox-consumer'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const params = () => ({
  attemptId: f.t01.attemptId,
  from: f.t01.from,
  question: 'Which format?',
  options: ['JSON', 'CSV'],
  timeoutMs: 0
})
const ask = (extra = {}) =>
  f.call(
    'axiom.attempt.ask',
    { ...params(), ...extra },
    { orchestrationCapability: f.t01.capability }
  )

describe('Mission questions', () => {
  it('persists one pending question, blocks admission, answers and resumes with stored evidence', async () => {
    expect(await ask()).toMatchObject({ ok: true, result: { timedOut: true } })
    const [message] = f.db.getUnreadRunMailbox(f.mission.runId)
    const id = message!.id
    expect(f.db.getQuestion(id)).toMatchObject({ status: 'pending', dispatch_id: f.t01.attemptId })
    expect(f.store.hasPendingQuestionForTask(f.t01.taskId)).toBe(true)
    expect(blockingQuestionOrApproval(f, f.store.getTaskStage(f.t01.taskId)!)).toBe('question')
    const consumer = new RunMailboxConsumer(f.runtime, f.store, f.missions, {
      missionId: f.mission.id,
      runId: f.mission.runId,
      consumerGeneration: 1
    })
    consumer.handle([message!])
    expect(
      await f.call('axiom.message.list', { missionId: f.mission.id, pendingOnly: true })
    ).toMatchObject({
      ok: true,
      result: {
        messages: [
          {
            id,
            type: 'QUESTION',
            question: 'Which format?',
            options: ['JSON', 'CSV'],
            answer: null,
            status: 'pending',
            pending: true
          }
        ]
      }
    })
    expect(
      await f.call('axiom.message.answer', {
        missionId: f.mission.id,
        questionId: id,
        body: 'JSON'
      })
    ).toMatchObject({ ok: true })
    expect(f.notify).toHaveBeenCalledWith(`dispatch:${f.t01.attemptId}`, 'status')
    expect(f.store.hasPendingQuestionForTask(f.t01.taskId)).toBe(false)
    expect(blockingQuestionOrApproval(f, f.store.getTaskStage(f.t01.taskId)!)).toBe('none')
    expect(await ask({ resume: id })).toMatchObject({
      ok: true,
      result: { answer: 'JSON', messageId: id, timedOut: false }
    })
    const question = f.db.getQuestion(id)!
    expect(f.db.getMessageById(question.answer_message_id!)).toMatchObject({
      body: 'JSON',
      to_handle: `dispatch:${f.t01.attemptId}`,
      thread_id: id
    })
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'message.received',
          objectId: id,
          after: expect.objectContaining({ type: 'QUESTION' })
        }),
        expect.objectContaining({ event: 'question.answered', objectId: id })
      ])
    )
    expect(
      await f.call('axiom.message.list', { missionId: f.mission.id, pendingOnly: true })
    ).toMatchObject({ ok: true, result: { messages: [] } })
  })
  it.each(['missing', 'wrong', 'stale', 'foreign', 'inactive', 'assignee'] as const)(
    'rejects %s authority without side effects',
    async (reason) => {
      if (reason === 'stale') {
        f.store.insertAttemptBinding({
          ...f.store.getAttemptBinding(f.t01.taskId, 1)!,
          seq: 2,
          dispatchId: null,
          branch: 'retry'
        })
      }
      if (reason === 'foreign' || reason === 'assignee') {
        f.panes.set(f.t01.from, 'foreign')
      }
      if (reason === 'assignee') {
        vi.spyOn(f.db, 'verifyDispatchCapability').mockReturnValue({ valid: true })
      }
      if (reason === 'inactive') {
        f.db.settleWorkerReport({
          taskId: f.t01.taskId,
          dispatchId: f.t01.attemptId,
          outcome: 'succeeded',
          result: 'settled'
        })
      }
      const before = f.snapshot()
      const capability =
        reason === 'missing' ? undefined : reason === 'wrong' ? 'dcap_wrong' : f.t01.capability
      expect(
        await f.call('axiom.attempt.ask', params(), { orchestrationCapability: capability })
      ).toMatchObject({
        ok: false,
        error: {
          code:
            reason === 'stale'
              ? 'stale_dispatch'
              : reason === 'inactive'
                ? 'inactive_dispatch'
                : reason === 'assignee'
                  ? 'sender_not_assignee'
                  : 'dispatch_capability_invalid'
        }
      })
      expect(f.snapshot()).toEqual(before)
      expect(f.db.db.prepare('SELECT * FROM question_threads').all()).toEqual([])
    }
  )
  it('returns dispatch_inactive after settlement closes a pending question', async () => {
    await ask()
    const id = f.db.getUnreadRunMailbox(f.mission.runId)[0]!.id
    f.db.settleWorkerReport({
      taskId: f.t01.taskId,
      dispatchId: f.t01.attemptId,
      outcome: 'succeeded',
      result: 'settled'
    })
    expect(f.db.getQuestion(id)?.status).toBe('closed')
    expect(
      await f.call('axiom.message.answer', {
        missionId: f.mission.id,
        questionId: id,
        body: 'late'
      })
    ).toMatchObject({ ok: false, error: { code: 'dispatch_inactive' } })
  })
})
it('answers an RPC waiter and replays ask/answer receipts without duplicate mail or audits', async () => {
  vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    const questionId = f.db.getUnreadRunMailbox(f.mission.runId)[0]!.id
    const p = { missionId: f.mission.id, questionId, body: 'CSV' }
    const envelope = { orchestrationRequestId: 'answer-retry' }
    expect(await f.call('axiom.message.answer', p, envelope)).toMatchObject({ ok: true })
    const before = f.snapshot()
    expect(await f.call('axiom.message.answer', p, envelope)).toMatchObject({
      ok: true,
      result: { mutation: { replayed: true } }
    })
    expect(f.snapshot()).toEqual(before)
    expect(await f.call('axiom.message.answer', { ...p, body: 'JSON' })).toMatchObject({
      ok: false,
      error: { code: 'answer_conflict' }
    })
    return 'notified'
  })
  const p = { ...params(), timeoutMs: 5000 }
  const envelope = {
    orchestrationRequestId: 'ask-retry',
    orchestrationCapability: f.t01.capability
  }
  expect(await f.call('axiom.attempt.ask', p, envelope)).toMatchObject({
    ok: true,
    result: { answer: 'CSV', timedOut: false }
  })
  const before = f.snapshot()
  expect(await f.call('axiom.attempt.ask', p, envelope)).toMatchObject({
    ok: true,
    result: { answer: 'CSV', mutation: { replayed: true } }
  })
  expect(f.snapshot()).toEqual(before)
})
it('checks Mission ownership on answer and retains an accepted receipt if notification fails', async () => {
  f.notify.mockImplementationOnce(() => {
    throw new Error('notification unavailable')
  })
  const envelope = {
    orchestrationRequestId: 'ask-notify-fail',
    orchestrationCapability: f.t01.capability
  }
  expect(await f.call('axiom.attempt.ask', params(), envelope)).toMatchObject({ ok: false })
  const before = f.snapshot()
  expect(await f.call('axiom.attempt.ask', params(), envelope)).toMatchObject({
    ok: true,
    result: { accepted: true, mutation: { replayed: true } }
  })
  expect(f.snapshot()).toEqual(before)
  const questionId = f.db.getUnreadRunMailbox(f.mission.runId)[0]!.id
  expect(
    await f.call('axiom.message.answer', {
      missionId: f.mission.id,
      questionId: 'missing',
      body: 'x'
    })
  ).toMatchObject({ ok: false, error: { code: 'question_not_found' } })
  const mission = f.missions.createMission({
    repoId: 'other',
    repoPath: '/other',
    targetBranch: 'main',
    goal: {
      objective: 'Other',
      constraints: [],
      acceptanceCriteria: [],
      provenance: { kind: 'user', actor: 'user', at: '2026-10-17T12:00:00Z' }
    },
    provenance: { kind: 'user', actor: 'user', at: '2026-10-17T12:00:00Z' }
  }).mission
  expect(
    await f.call('axiom.message.answer', { missionId: mission.id, questionId, body: 'x' })
  ).toMatchObject({ ok: false, error: { code: 'question_not_found' } })
})
it('preserves answer whitespace in the persisted body and resumed response', async () => {
  await ask()
  const questionId = f.db.getUnreadRunMailbox(f.mission.runId)[0]!.id
  const body = '  preserve indentation\n'
  expect(
    await f.call('axiom.message.answer', { missionId: f.mission.id, questionId, body })
  ).toMatchObject({ ok: true, result: { question: { answer_body: body } } })
  expect(await ask({ resume: questionId })).toMatchObject({ ok: true, result: { answer: body } })
})
