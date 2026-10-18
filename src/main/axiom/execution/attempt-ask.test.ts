import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from './attempt-channel-fixture.test-support'
import { askAttempt } from './attempt-ask'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
function ask(extra = {}, signal?: AbortSignal, recordMutationReceipt = vi.fn()) {
  return askAttempt(
    { attemptId: f.t01.attemptId, from: f.t01.from, question: 'Format?', timeoutMs: 100, ...extra },
    { runtime: f.runtime, signal, orchestrationCapability: f.t01.capability, recordMutationReceipt }
  )
}
it('wakes from answer RPC and returns its body, after recording acceptance', async () => {
  const recorded = vi.fn()
  const wait = vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async (address) => {
    expect(address).toBe(`dispatch:${f.t01.attemptId}`)
    expect(recorded).toHaveBeenCalledWith(expect.objectContaining({ accepted: true, answer: null }))
    const id = f.db.getUnreadRunMailbox(f.mission.runId)[0]!.id
    expect(
      await f.call('axiom.message.answer', {
        missionId: f.mission.id,
        questionId: id,
        body: 'JSON'
      })
    ).toMatchObject({ ok: true })
    return 'notified'
  })
  expect(await ask({}, undefined, recorded)).toMatchObject({ answer: 'JSON', timedOut: false })
  expect(wait).toHaveBeenCalledOnce()
})
it('times out after a fake waiter advances to the deadline', async () => {
  vi.useFakeTimers()
  vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    vi.advanceTimersByTime(100)
    return 'timed_out'
  })
  expect(await ask()).toMatchObject({ answer: null, timedOut: true, cancelled: false })
})
it('cancels an outstanding wait without closing the durable question', async () => {
  const abort = new AbortController()
  vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    abort.abort()
    return 'cancelled'
  })
  const result = await ask({}, abort.signal)
  expect(result).toMatchObject({ answer: null, cancelled: true, connectionLost: true })
  expect(f.db.getQuestion(result.messageId)?.status).toBe('pending')
})
it('returns dispatch_inactive when settlement closes the thread during a wait', async () => {
  vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    f.db.settleWorkerReport({
      taskId: f.t01.taskId,
      dispatchId: f.t01.attemptId,
      outcome: 'succeeded',
      result: 'settled'
    })
    return 'notified'
  })
  await expect(ask()).rejects.toMatchObject({ code: 'dispatch_inactive' })
})
it('resumes without another message and rejects a different dispatch question', async () => {
  const first = await ask({ timeoutMs: 0 })
  await expect(ask({ resume: first.messageId, timeoutMs: 0 })).resolves.toMatchObject({
    messageId: first.messageId,
    timedOut: true
  })
  expect(f.db.getUnreadRunMailbox(f.mission.runId)).toHaveLength(1)
  const other = f.bind('T02')
  const foreign = f.db.createQuestion({
    runId: f.mission.runId,
    dispatchId: other.attemptId,
    askerHandle: other.from,
    question: 'Other?'
  })
  await expect(ask({ resume: foreign.message.id })).rejects.toMatchObject({
    code: 'question_not_found'
  })
  await expect(ask({ resume: 'missing' })).rejects.toMatchObject({ code: 'question_not_found' })
})
