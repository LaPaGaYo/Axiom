import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from './execution/attempt-channel-fixture.test-support'
import { AttemptCheckResponseSchema } from '../../shared/axiom-contract/attempt-params'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
it('reads only the assignee dispatch mailbox without a mutation fence or receipt', async () => {
  const t04 = f.bind('T04')
  await f.call(
    'axiom.attempt.inform',
    { from: f.t01.from, attemptId: f.t01.attemptId, summary: 'Downstream evidence' },
    { orchestrationCapability: f.t01.capability }
  )
  const receipts = f.db.db.prepare('SELECT * FROM mutation_receipts').all()
  for (const worker of [t04, f.t01]) {
    const result = await f.call(
      'axiom.attempt.check',
      { attemptId: worker.attemptId, from: worker.from },
      { orchestrationCapability: worker.capability, orchestrationContractVersion: undefined }
    )
    expect(result.ok).toBe(true)
    if (!result.ok) {
      throw new Error(result.error.code)
    }
    expect(AttemptCheckResponseSchema.parse(result.result)).toMatchObject({
      dispatchId: worker.attemptId,
      count: worker === t04 ? 1 : 0
    })
  }
  expect(f.db.db.prepare('SELECT * FROM mutation_receipts').all()).toEqual(receipts)
})
it('passes the dispatch waiter, timeout and routing-type filter to the kernel and returns arriving mail', async () => {
  const t04 = f.bind('T04')
  const wait = vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    await f.call(
      'axiom.attempt.handoff',
      { from: f.t01.from, attemptId: f.t01.attemptId, summary: 'Arrived' },
      { orchestrationCapability: f.t01.capability }
    )
    return 'notified'
  })
  expect(
    await f.call(
      'axiom.attempt.check',
      { attemptId: t04.attemptId, from: t04.from, wait: true, timeoutMs: 5000, type: 'handoff' },
      { orchestrationCapability: t04.capability }
    )
  ).toMatchObject({ ok: true, result: { count: 1, messages: [{ subject: 'Arrived' }] } })
  expect(wait).toHaveBeenCalledWith(
    `dispatch:${t04.attemptId}`,
    expect.objectContaining({ timeoutMs: 5000, typeFilter: ['handoff'] })
  )
})
it.each(['missing', 'wrong', 'stale', 'foreign', 'inactive'] as const)(
  'check rejects %s authority before reading mail',
  async (reason) => {
    if (reason === 'stale') {
      f.store.insertAttemptBinding({
        ...f.store.getAttemptBinding(f.t01.taskId, 1)!,
        seq: 2,
        dispatchId: null,
        branch: 'retry'
      })
    }
    if (reason === 'foreign') {
      f.panes.set(f.t01.from, 'foreign')
    }
    if (reason === 'inactive') {
      f.db.settleWorkerReport({
        taskId: f.t01.taskId,
        dispatchId: f.t01.attemptId,
        outcome: 'succeeded',
        result: 'done'
      })
    }
    const before = f.snapshot()
    const read = vi.spyOn(f.db, 'getOrCreateMailboxDelivery')
    const capability =
      reason === 'missing' ? undefined : reason === 'wrong' ? 'dcap_wrong' : f.t01.capability
    expect(
      await f.call(
        'axiom.attempt.check',
        { from: f.t01.from, attemptId: f.t01.attemptId },
        { orchestrationCapability: capability }
      )
    ).toMatchObject({
      ok: false,
      error: {
        code:
          reason === 'stale'
            ? 'stale_dispatch'
            : reason === 'inactive'
              ? 'inactive_dispatch'
              : 'dispatch_capability_invalid'
      }
    })
    expect(f.snapshot()).toEqual(before)
    expect(read).not.toHaveBeenCalled()
  }
)
it('revalidates consumer generation after a long-poll wake', async () => {
  vi.spyOn(f.runtime, 'waitForMessage').mockImplementation(async () => {
    f.db.mintDispatchCapability({
      dispatchId: f.t01.attemptId,
      paneKey: f.t01.paneKey,
      processIncarnation: f.t01.processIncarnation
    })
    return 'notified'
  })
  expect(
    await f.call(
      'axiom.attempt.check',
      { from: f.t01.from, attemptId: f.t01.attemptId, wait: true },
      { orchestrationCapability: f.t01.capability }
    )
  ).toMatchObject({ ok: false, error: { code: 'consumer_fenced' } })
})
