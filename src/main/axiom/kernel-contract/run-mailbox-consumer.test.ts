import { formatOrcaSessionAddress } from '../../../shared/orca-session-address'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { OrchestrationDb } from '../../runtime/orchestration/db'

describe('D14 Mission Run mailbox consumer', () => {
  let db: OrchestrationDb
  let directory: string | undefined
  const sessionId = testOrcaSessionId('axiom-mission-mailbox-contract')

  beforeEach(() => {
    db = new OrchestrationDb(':memory:')
  })

  afterEach(() => {
    db.close()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
      directory = undefined
    }
  })

  function createMissionRun() {
    return db.createRun({
      objective: 'Deterministic consumer',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: sessionId
    })
  }

  it('replays a delivery until acknowledgement and acknowledges it idempotently', () => {
    const run = createMissionRun()
    const message = db.insertMessage({
      from: 'term_sender',
      to: `run:${run.id}`,
      subject: 'Submission available',
      runId: run.id
    })
    const consumer = { runId: run.id, consumerGeneration: run.consumer_generation }
    expect(db.getUnreadRunMailbox(run.id)).toEqual([message])
    const first = db.getOrCreateRunDelivery(consumer)
    expect(first).toMatchObject({ replayed: false, messages: [message] })
    if (!first) {
      throw new Error('Expected a Run delivery')
    }
    expect(db.hasOutstandingRunDelivery(run.id)).toBe(true)
    expect(db.getOrCreateRunDelivery(consumer)).toEqual({ ...first, replayed: true })
    const ack = { ...consumer, deliveryId: first.delivery.id }
    expect(db.acknowledgeRunDelivery(ack).duplicate).toBe(false)
    expect(db.acknowledgeRunDelivery(ack).duplicate).toBe(true)
    expect(db.hasOutstandingRunDelivery(run.id)).toBe(false)
    expect(db.getUnreadRunMailbox(run.id)).toEqual([])
    expect(db.getOrCreateRunDelivery(consumer)).toBeUndefined()
    expect(db.getRunMailboxHistory(run.id)).toMatchObject([{ id: message.id, read: 1 }])
  })

  it('fences stale reads and acknowledgements without consuming mail', () => {
    const run = createMissionRun()
    db.insertMessage({
      from: 'term_sender',
      to: `run:${run.id}`,
      subject: 'Pending',
      runId: run.id
    })
    const delivery = db.getOrCreateRunDelivery({
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })
    if (!delivery) {
      throw new Error('Expected a Run delivery')
    }
    const stale = { runId: run.id, consumerGeneration: run.consumer_generation - 1 }
    for (const consume of [
      () => db.requireCurrentConsumer(stale.runId, stale.consumerGeneration),
      () => db.getOrCreateRunDelivery(stale),
      () => db.acknowledgeRunDelivery({ ...stale, deliveryId: delivery.delivery.id })
    ]) {
      expect(consume).toThrowError(expect.objectContaining({ code: 'consumer_fenced' }))
    }
    expect(db.getUnreadRunMailbox(run.id)).toHaveLength(1)
    expect(db.hasOutstandingRunDelivery(run.id)).toBe(true)
  })

  it('continues an outstanding delivery with the same generation after file reopen', () => {
    directory = mkdtempSync(join(tmpdir(), 'axiom-run-mailbox-'))
    const path = join(directory, 'orchestration.db')
    db.close()
    db = new OrchestrationDb(path)
    const run = createMissionRun()
    const consumer = { runId: run.id, consumerGeneration: run.consumer_generation }
    const message = db.insertMessage({
      from: 'term_sender',
      to: `run:${run.id}`,
      subject: 'Before restart',
      runId: run.id
    })
    const first = db.getOrCreateRunDelivery(consumer)
    if (!first) {
      throw new Error('Expected a Run delivery')
    }
    db.close()
    db = new OrchestrationDb(path)

    expect(db.getRun(run.id)).toEqual(run)
    expect(db.requireCurrentConsumer(run.id, run.consumer_generation)).toMatchObject({
      id: run.id,
      consumer_generation: run.consumer_generation
    })
    expect(db.getUnreadRunMailbox(run.id)).toEqual([message])
    expect(db.getOrCreateRunDelivery(consumer)).toEqual({ ...first, replayed: true })
    const ack = { ...consumer, deliveryId: first.delivery.id }
    expect(db.acknowledgeRunDelivery(ack).duplicate).toBe(false)
    const next = db.insertMessage({
      from: 'term_sender',
      to: formatOrcaSessionAddress(sessionId),
      subject: 'After restart',
      runId: run.id
    })
    expect(next.to_handle).toBe(`run:${run.id}`)
    expect(db.getOrCreateRunDelivery(consumer)).toMatchObject({ replayed: false, messages: [next] })
    db.close()
    db = new OrchestrationDb(path)
    expect(db.acknowledgeRunDelivery(ack).duplicate).toBe(true)
  })

  it('reads run-scoped session mail through the Run and unbound mail through the direct inbox', () => {
    const run = createMissionRun()
    const address = formatOrcaSessionAddress(sessionId)
    const scoped = db.insertMessage({
      from: 'term_sender',
      to: address,
      subject: 'Mission mail',
      runId: run.id
    })
    expect(scoped.to_handle).toBe(`run:${run.id}`)
    expect(db.getUnreadRunMailbox(run.id)).toEqual([scoped])
    expect(db.getUnreadMessages(address)).toEqual([])
    const unbound = db.insertMessage({ from: 'term_sender', to: address, subject: 'Unbound mail' })
    expect(unbound.to_handle).toBe(address)
    expect(db.getUnreadMessages(address)).toEqual([unbound])
    expect(() =>
      db.getOrCreateMailboxDelivery({
        runId: unbound.run_id,
        mailboxHandle: address,
        consumerGeneration: run.consumer_generation
      })
    ).toThrowError(expect.objectContaining({ code: 'consumer_fenced' }))
  })
})
