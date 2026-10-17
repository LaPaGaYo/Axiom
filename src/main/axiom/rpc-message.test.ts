import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture, subtask } from './execution/attempt-channel-fixture.test-support'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it('lists pending REQUEST_SUBTASK messages and filters by type/Task/Attempt', async () => {
  expect(
    await f.call(
      'axiom.attempt.request-subtask',
      {
        from: f.t01.from,
        attemptId: f.t01.attemptId,
        summary: 'Please split',
        subtask
      },
      { orchestrationCapability: f.t01.capability }
    )
  ).toMatchObject({ ok: true })
  const messages = f.db.getUnreadRunMailbox(f.mission.runId)
  const list = {
    missionId: f.mission.id,
    type: 'REQUEST_SUBTASK',
    taskId: f.t01.taskId,
    attemptId: f.t01.attemptId,
    pendingOnly: true
  }
  expect(
    await f.call('axiom.message.list', list, { orchestrationContractVersion: undefined })
  ).toMatchObject({
    ok: true,
    result: {
      messages: [
        {
          id: messages[0]!.id,
          type: 'REQUEST_SUBTASK',
          summary: 'Please split',
          pending: true,
          subtask
        }
      ]
    }
  })
  expect(await f.call('axiom.message.list', { ...list, taskId: 'other' })).toMatchObject({
    ok: true,
    result: { messages: [] }
  })
  f.store.appendAuditEvent({
    missionId: f.mission.id,
    actor: 'Control Plane',
    objectKind: 'message',
    objectId: messages[0]!.id,
    event: 'subtask.resolved',
    before: null,
    after: { resolution: 'rejected' }
  })
  expect(await f.call('axiom.message.list', list)).toMatchObject({
    ok: true,
    result: { messages: [] }
  })
  expect(await f.call('axiom.message.list', { ...list, pendingOnly: false })).toMatchObject({
    ok: true,
    result: { messages: [{ pending: false }] }
  })
})
it('refuses unknown Mission and skips non-Axiom/malformed payloads', async () => {
  for (const payload of [undefined, '{', JSON.stringify({ axiom: { type: 'INFORM' } })]) {
    f.db.insertMessage({
      from: f.t01.from,
      to: `run:${f.mission.runId}`,
      runId: f.mission.runId,
      subject: 'legacy',
      payload
    })
  }
  expect(await f.call('axiom.message.list', { missionId: f.mission.id })).toMatchObject({
    ok: true,
    result: { messages: [] }
  })
  expect(await f.call('axiom.message.list', { missionId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'mission_not_found' }
  })
})
