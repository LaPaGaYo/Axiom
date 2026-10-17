import { afterEach, describe, expect, it, vi } from 'vitest'
import { testOrcaSessionId } from '../../../shared/orca-session-address-test-fixture'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrchestrationMailboxNotificationCoordinator } from '../../runtime/orchestration/mailbox-notification-coordinator'

describe('Mission Run mailbox notification', () => {
  let db: OrchestrationDb

  afterEach(() => db?.close())

  it('wakes a matching Run waiter without terminal delivery or consuming the message', () => {
    db = new OrchestrationDb(':memory:')
    const run = db.createRun({
      objective: 'Wake the deterministic consumer',
      coordinatorHandle: null,
      coordinatorPaneKey: null,
      coordinatorOrcaSessionId: testOrcaSessionId('axiom-mission-notification-contract')
    })
    const address = `run:${run.id}`
    const message = db.insertMessage({
      from: 'term_sender',
      to: address,
      subject: 'Wake',
      type: 'status',
      runId: run.id
    })
    const waiting = { typeFilter: ['status'] }
    const other = { typeFilter: ['question'] }
    const resolveMessageWaiter = vi.fn()
    const deliverForHandle = vi.fn()
    const deps = {
      getDb: () => db,
      getMessageWaiters: (handle: string) =>
        handle === address ? new Set([waiting, other]) : undefined,
      resolveMessageWaiter,
      deliverForHandle
    }
    type Dependencies = ConstructorParameters<typeof OrchestrationMailboxNotificationCoordinator>[0]
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: a run address with a matching waiter bypasses all terminal/pointer dependencies; absent methods fail loudly if that contract regresses.
    const notificationDeps = deps as unknown as Dependencies
    const coordinator = new OrchestrationMailboxNotificationCoordinator(notificationDeps)
    coordinator.notifyMessageArrived(address, message.type)

    expect(resolveMessageWaiter).toHaveBeenCalledExactlyOnceWith(waiting)
    expect(deliverForHandle).not.toHaveBeenCalled()
    expect(db.getUnreadRunMailbox(run.id)).toEqual([message])
    expect(
      db.getOrCreateRunDelivery({
        runId: run.id,
        consumerGeneration: run.consumer_generation
      })
    ).toMatchObject({ messages: [message], replayed: false })
  })
})
