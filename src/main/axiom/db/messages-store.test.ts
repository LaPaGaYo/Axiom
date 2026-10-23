import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture, subtask } from '../execution/attempt-channel-fixture.test-support'
import { messagesStore } from './messages-store'
let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it('lists in insertion order, filters typed rows, and does not trust a foreign payload Mission', async () => {
  for (const verb of ['inform', 'request-subtask']) {
    await f.call(`axiom.attempt.${verb}`, {
      from: f.t01.from,
      attemptId: f.t01.attemptId,
      summary: verb,
      ...(verb === 'request-subtask' ? { subtask } : {})
    })
  }
  const mail = f.db.getUnreadRunMailbox(f.mission.runId)
  f.db.insertMessage({
    from: 'external',
    to: `run:${f.mission.runId}`,
    runId: f.mission.runId,
    subject: 'wrong Mission',
    payload: mail[0]!.payload!.replace(f.mission.id, 'foreign-mission')
  })
  const store = messagesStore(f.db)
  expect(store.listMessages({ missionId: f.mission.id }).map((m) => m.id)).toEqual(
    mail.map((m) => m.id)
  )
  expect(store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toMatchObject([
    { type: 'REQUEST_SUBTASK', pending: true }
  ])
  expect(store.listMessages({ missionId: f.mission.id, type: 'INFORM' })).toHaveLength(1)
  expect(store.listMessages({ missionId: f.mission.id, attemptId: 'missing' })).toEqual([])
})
