import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, planned } from './controller-fixture.test-support'
import { insertMail, mailboxRuntime, replaceRunBinding } from '../mailbox-runtime.test-support'
import { RunMailboxConsumer } from './run-mailbox-consumer'

describe('Mission Run mailbox consumer', () => {
  let f: ReturnType<typeof planned>
  let runtime: ReturnType<typeof mailboxRuntime>
  let consumer: RunMailboxConsumer

  beforeEach(() => {
    vi.useFakeTimers()
    f = planned(fixture())
    f.controller.startExecution(f.missionId)
    runtime = mailboxRuntime(f.db)
    consumer = makeConsumer()
  })
  afterEach(() => {
    consumer.stop()
    vi.useRealTimers()
    vi.restoreAllMocks()
    f.db.close()
  })
  function makeConsumer() {
    const mission = f.controller.getMission(f.missionId)
    const run = f.db.getRun(mission.runId)!
    return new RunMailboxConsumer(runtime, f.store, f.controller, {
      missionId: mission.id,
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })
  }
  function audits() {
    return f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => e.event === 'mailbox.message')
  }

  it('registers before draining, wakes immediately, and releases the waiter on stop', async () => {
    const runId = f.controller.getMission(f.missionId).runId
    const drain = vi.spyOn(f.db, 'getOrCreateRunDelivery')
    const running = consumer.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(runtime.waitForMessage.mock.invocationCallOrder[0]).toBeLessThan(
      drain.mock.invocationCallOrder[0]!
    )
    const message = insertMail(f.db, runId)
    runtime.notifyMessageArrived(`run:${runId}`, 'status')
    await vi.advanceTimersByTimeAsync(0)
    expect(audits()).toMatchObject([{ objectId: message.id }])
    expect(f.db.getUnreadRunMailbox(runId)).toEqual([])
    expect(f.db.hasOutstandingRunDelivery(runId)).toBe(false)
    consumer.stop()
    await running
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves a failed batch outstanding, replays it, and audits each message exactly once', () => {
    const runId = f.controller.getMission(f.missionId).runId
    const messages = [insertMail(f.db, runId), insertMail(f.db, runId)]
    const handle = consumer.handle.bind(consumer)
    vi.spyOn(consumer, 'handle').mockImplementationOnce((batch) => {
      handle(batch)
      throw new Error('crash after durable effects, before ack')
    })
    const deliveries = vi.spyOn(f.db, 'getOrCreateRunDelivery')
    expect(() => consumer.drain()).toThrow('crash after durable effects')
    expect(f.db.hasOutstandingRunDelivery(runId)).toBe(true)
    expect(f.db.getUnreadRunMailbox(runId)).toHaveLength(2)
    consumer.drain()
    expect(deliveries.mock.results[1]?.value).toMatchObject({ replayed: true, messages })
    expect(audits().map((e) => e.objectId)).toEqual(messages.map((m) => m.id))
    expect(f.db.hasOutstandingRunDelivery(runId)).toBe(false)
  })

  it('retries a handler error after bounded backoff without acknowledging early', async () => {
    const log = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const runId = f.controller.getMission(f.missionId).runId
    insertMail(f.db, runId)
    vi.spyOn(consumer, 'handle').mockImplementationOnce(() => {
      throw new Error('handler failed')
    })
    const running = consumer.start()
    await vi.advanceTimersByTimeAsync(0)
    expect(log).toHaveBeenCalled()
    expect(f.db.hasOutstandingRunDelivery(runId)).toBe(true)
    await vi.advanceTimersByTimeAsync(249)
    expect(audits()).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(audits()).toHaveLength(1)
    expect(f.db.hasOutstandingRunDelivery(runId)).toBe(false)
    consumer.stop()
    await running
  })

  it('stops and blocks on a generation fence without acknowledging the message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const mission = f.controller.getMission(f.missionId)
    const running = consumer.start()
    await vi.advanceTimersByTimeAsync(0)
    insertMail(f.db, mission.runId)
    replaceRunBinding(f.db, mission.coordinatorOrcaSessionId)
    runtime.notifyMessageArrived(`run:${mission.runId}`, 'status')
    await vi.advanceTimersByTimeAsync(0)
    await running
    expect(f.controller.getMission(mission.id).status).toBe('BLOCKED')
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'mission.status',
          after: expect.objectContaining({ reason: 'consumer_fenced' })
        })
      ])
    )
    expect(f.db.getUnreadRunMailbox(mission.runId)).toHaveLength(1)
    expect(audits()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects a second exclusive consumer before it drains even with backlog', async () => {
    const running = consumer.start()
    await vi.advanceTimersByTimeAsync(0)
    insertMail(f.db, f.controller.getMission(f.missionId).runId)
    const second = makeConsumer()
    const drain = vi.spyOn(second, 'drain')
    expect(await second.start()).toBe('waiter_exists')
    expect(drain).not.toHaveBeenCalled()
    expect(audits()).toEqual([])
    consumer.stop()
    await running
  })
})
