import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from '../execution/attempt-channel-fixture.test-support'
import { routeWorkerMessage } from './message-router'
import { resolveAttemptSender } from '../execution/attempt-authority'
import { AXIOM_MESSAGE_TYPES } from '../../../shared/axiom-contract/message-params'
import {
  AttemptAskParams,
  AttemptMessageParams
} from '../../../shared/axiom-contract/attempt-params'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
it('redacts typed BLOCKED Worker strings at the message boundary and keeps the live Task RUNNING', async () => {
  const secret = 'ghp_1234567890abcdefghijklmnop'
  const response = await f.call('axiom.attempt.blocked', {
    from: f.t01.from,
    attemptId: f.t01.attemptId,
    summary: `Blocked ${secret}`,
    body: `Evidence ${secret}`,
    blocked: { reason: 'blocked_by_scope', paths: [`src/${secret}.ts`] }
  })
  expect(response).toMatchObject({
    ok: true,
    result: {
      message: {
        pending: true,
        summary: 'Blocked [REDACTED]',
        blocked: { reason: 'blocked_by_scope', paths: ['src/[REDACTED].ts'] }
      }
    }
  })
  const message = f.db.getUnreadRunMailbox(f.mission.runId)[0]!
  expect(message.body).toBe('Evidence [REDACTED]')
  expect(JSON.stringify(message)).not.toContain(secret)
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it.each(AXIOM_MESSAGE_TYPES)('DEF-21: typed %s is delivered only to the Run mailbox', (type) => {
  const downstream = f.bind('T04')
  const { sender } = resolveAttemptSender({ ...f, ...f.t01 })
  const result = routeWorkerMessage(f, {
    sender,
    axiom: {
      version: 1,
      type,
      missionId: f.mission.id,
      taskId: f.t01.taskId,
      attemptId: f.t01.attemptId,
      summary: 'For the Control Plane',
      artifactIds: [],
      related: { taskIds: [downstream.taskId] },
      ...(type === 'QUESTION' ? { question: { text: 'Human input needed', options: [] } } : {}),
      ...(type === 'REQUEST_SUBTASK'
        ? {
            subtask: {
              title: 'Follow-up',
              objective: 'Scoped follow-up',
              allowedPaths: ['a.ts'],
              acceptanceCriteria: [{ text: 'Reviewed', check: { kind: 'human' as const } }],
              risk: 'low' as const
            }
          }
        : {})
    }
  })
  expect(result.recipients).toEqual([`run:${f.mission.runId}`])
  expect(f.db.getInbox(100).map((message) => message.to_handle)).toEqual([`run:${f.mission.runId}`])
  expect(f.db.getUnreadMessages(`dispatch:${downstream.attemptId}`)).toEqual([])
})
it('strict Attempt message and question params reject an explicit recipient', () => {
  const sender = { attemptId: f.t01.attemptId, from: f.t01.from }
  expect(
    AttemptAskParams.safeParse({ ...sender, question: 'Ask', to: 'another-worker' }).success
  ).toBe(false)
  expect(
    AttemptMessageParams.safeParse({ ...sender, summary: 'Message', to: 'another-worker' }).success
  ).toBe(false)
})
it.each(['inform', 'handoff', 'request'] as const)(
  '%s routes only to the Control Plane, even with eligible downstream Attempts',
  async (verb) => {
    const t04 = f.bind('T04')
    const t07 = f.bind('T07')
    const response = await f.call(`axiom.attempt.${verb}`, {
      from: f.t01.from,
      attemptId: f.t01.attemptId,
      summary: verb
    })
    expect(response.ok).toBe(true)
    const cp = f.db.getUnreadRunMailbox(f.mission.runId)[0]!
    expect(f.db.getInbox(100)).toHaveLength(1)
    expect(f.db.getUnreadMessages(`dispatch:${t07.attemptId}`)).toEqual([])
    const downstream = f.db.getUnreadMessages(`dispatch:${t04.attemptId}`)
    expect(downstream).toHaveLength(0)
    expect(cp.to_handle).toBe(`run:${f.mission.runId}`)
    expect(f.notify).toHaveBeenCalledExactlyOnceWith(`run:${f.mission.runId}`, cp.type)
    expect(f.db.getInbox(100).every((m) => !m.to_handle.startsWith('@'))).toBe(true)
  }
)
it.each(['inform', 'handoff'] as const)(
  '%s related Task references never address another Worker',
  async (verb) => {
    const t04 = f.bind('T04')
    const t07 = f.bind('T07')
    expect(
      await f.call(`axiom.attempt.${verb}`, {
        from: f.t01.from,
        attemptId: f.t01.attemptId,
        summary: 'Targeted handoff',
        related: { taskIds: [t07.taskId, t07.taskId] }
      })
    ).toMatchObject({ ok: true })
    expect(f.db.getUnreadMessages(`dispatch:${t04.attemptId}`)).toEqual([])
    expect(f.db.getUnreadMessages(`dispatch:${t07.attemptId}`)).toHaveLength(0)
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
    await f.call('axiom.attempt.inform', {
      from: f.t01.from,
      attemptId: f.t01.attemptId,
      summary: 'News'
    })
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
    await f.call('axiom.attempt.inform', {
      from: f.t01.from,
      attemptId: f.t01.attemptId,
      summary: 'Invalid',
      ...extra
    })
  ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(f.snapshot()).toEqual(before)
  expect(f.notify).not.toHaveBeenCalled()
})
it('rolls back all copies and audit if persistence fails, with no notifications', () => {
  f.bind('T04')
  const { sender } = resolveAttemptSender({
    ...f,
    ...f.t01
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
    orchestrationRequestId: 'notify-failure'
  }
  expect((await f.call('axiom.attempt.inform', params, envelope)).ok).toBe(false)
  expect(await f.call('axiom.attempt.inform', params, envelope)).toMatchObject({ ok: true })
  expect(f.db.getUnreadRunMailbox(f.mission.runId)).toHaveLength(1)
})
