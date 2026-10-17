import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  channelFixture,
  subtask,
  workerVerbs,
  workerTypes
} from '../execution/attempt-channel-fixture.test-support'
import { RunMailboxConsumer } from './run-mailbox-consumer'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it('drains typed Worker mail, records pending/blocked reports once across replay, and leaves stages alone', async () => {
  for (const verb of workerVerbs) {
    expect(
      await f.call(
        `axiom.attempt.${verb}`,
        {
          from: f.t01.from,
          attemptId: f.t01.attemptId,
          summary: verb,
          ...(verb === 'request-subtask' ? { subtask } : {})
        },
        { orchestrationCapability: f.t01.capability }
      )
    ).toMatchObject({ ok: true })
  }
  const before = f.store.listTaskStages({ missionId: f.mission.id })
  const consumer = new RunMailboxConsumer(f.runtime, f.store, f.missions, {
    missionId: f.mission.id,
    runId: f.mission.runId,
    consumerGeneration: f.db.getRun(f.mission.runId)!.consumer_generation
  })
  const handle = consumer.handle.bind(consumer)
  vi.spyOn(consumer, 'handle').mockImplementationOnce((messages) => {
    handle(messages)
    throw new Error('crash before ack')
  })
  expect(() => consumer.drain()).toThrow('crash before ack')
  consumer.drain()
  const events = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(events.filter((e) => e.event === 'message.received')).toMatchObject(
    workerTypes.map((type) => ({ after: { type } }))
  )
  expect(events.filter((e) => e.event === 'mailbox.message')).toEqual([])
  expect(events.filter((e) => e.event === 'subtask.requested')).toMatchObject([
    { after: { subtask } }
  ])
  expect(events.filter((e) => e.event === 'attempt.blocked_reported')).toHaveLength(1)
  expect(f.db.getUnreadRunMailbox(f.mission.runId)).toEqual([])
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toHaveLength(1)
  expect(f.store.listTaskStages({ missionId: f.mission.id })).toEqual(before)
})
