import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { routeWorkerMessage } from './message-router'
import { resolveAttemptSender } from '../execution/attempt-authority'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it.each(['inform', 'handoff', 'request'] as const)(
  '%s routes only to the Control Plane and eligible direct downstream Attempts',
  async (verb) => {
    const t04 = f.bind('T04')
    const t07 = f.bind('T07')
    const response = await f.call(
      `axiom.attempt.${verb}`,
      { from: f.t01.from, attemptId: f.t01.attemptId, summary: verb },
      { orchestrationCapability: f.t01.capability }
    )
    expect(response.ok).toBe(true)
    const cp = f.db.getUnreadRunMailbox(f.mission.runId)[0]!
    expect(f.db.getInbox(100)).toHaveLength(verb === 'request' ? 1 : 2)
    expect(f.db.getUnreadMessages(`dispatch:${t07.attemptId}`)).toEqual([])
    const downstream = f.db.getUnreadMessages(`dispatch:${t04.attemptId}`)
    expect(downstream).toHaveLength(verb === 'request' ? 0 : 1)
    if (verb !== 'request') {
      expect(downstream[0]).toMatchObject({ thread_id: cp.id, payload: cp.payload })
      expect(f.notify).toHaveBeenCalledWith(`dispatch:${t04.attemptId}`, cp.type)
    }
    expect(f.notify).toHaveBeenCalledTimes(verb === 'request' ? 1 : 2)
    expect(f.db.getInbox(100).every((m) => !m.to_handle.startsWith('@'))).toBe(true)
  }
)
it.each(['inform', 'handoff'] as const)(
  '%s explicit related Task list replaces defaults and deduplicates',
  async (verb) => {
    const t04 = f.bind('T04')
    const t07 = f.bind('T07')
    expect(
      await f.call(
        `axiom.attempt.${verb}`,
        {
          from: f.t01.from,
          attemptId: f.t01.attemptId,
          summary: 'Targeted handoff',
          related: { taskIds: [t07.taskId, t07.taskId] }
        },
        { orchestrationCapability: f.t01.capability }
      )
    ).toMatchObject({ ok: true })
    expect(f.db.getUnreadMessages(`dispatch:${t04.attemptId}`)).toEqual([])
    expect(f.db.getUnreadMessages(`dispatch:${t07.attemptId}`)).toHaveLength(1)
    expect(f.db.getUnreadRunMailbox(f.mission.runId)).toHaveLength(1)
  }
)
it('skips a downstream Attempt when a newer pending binding supersedes it', async () => {
  const t04 = f.bind('T04')
  f.store.insertAttemptBinding({
    ...f.store.getAttemptBinding(t04.taskId, 1)!,
    seq: 2,
    dispatchId: null,
    branch: 'retry'
  })
  expect(
    await f.call(
      'axiom.attempt.inform',
      { from: f.t01.from, attemptId: f.t01.attemptId, summary: 'News' },
      { orchestrationCapability: f.t01.capability }
    )
  ).toMatchObject({ ok: true })
  expect(f.db.getUnreadMessages(`dispatch:${t04.attemptId}`)).toEqual([])
})
it.each([
  { artifactIds: ['missing'] },
  { related: { taskIds: ['foreign-task'] } },
  { related: { artifactId: 'missing' } }
])('rejects foreign references before writes: %j', async (extra) => {
  const before = f.snapshot()
  expect(
    await f.call(
      'axiom.attempt.inform',
      { from: f.t01.from, attemptId: f.t01.attemptId, summary: 'Invalid', ...extra },
      { orchestrationCapability: f.t01.capability }
    )
  ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(f.snapshot()).toEqual(before)
  expect(f.notify).not.toHaveBeenCalled()
})
it('rolls back all copies and audit if persistence fails, with no notifications', () => {
  f.bind('T04')
  const { sender } = resolveAttemptSender({
    ...f,
    ...f.t01,
    orchestrationCapability: f.t01.capability
  })
  const before = f.snapshot()
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('write failed')
  })
  expect(() =>
    routeWorkerMessage(f, {
      sender,
      axiom: {
        version: 1,
        type: 'INFORM',
        missionId: f.mission.id,
        taskId: f.t01.taskId,
        attemptId: f.t01.attemptId,
        summary: 'Atomic',
        artifactIds: [],
        related: {}
      }
    })
  ).toThrow('write failed')
  expect(f.snapshot()).toEqual(before)
  expect(f.notify).not.toHaveBeenCalled()
})
it('keeps a durable receipt if notification fails, so a retry cannot duplicate mail', async () => {
  f.notify.mockImplementationOnce(() => {
    throw new Error('notification failed')
  })
  const params = { from: f.t01.from, attemptId: f.t01.attemptId, summary: 'Durable' }
  const envelope = {
    orchestrationCapability: f.t01.capability,
    orchestrationRequestId: 'notify-failure'
  }
  expect((await f.call('axiom.attempt.inform', params, envelope)).ok).toBe(false)
  expect(await f.call('axiom.attempt.inform', params, envelope)).toMatchObject({ ok: true })
  expect(f.db.getUnreadRunMailbox(f.mission.runId)).toHaveLength(1)
})
