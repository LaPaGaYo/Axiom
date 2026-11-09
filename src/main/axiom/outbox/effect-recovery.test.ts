import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from '../db/axiom-store'
import { EffectOutbox } from './effect-outbox'
import type { EffectOf } from '../../../shared/axiom-contract/effects'

let db: OrchestrationDb
let store: AxiomStore
let outbox: EffectOutbox
const now = '2026-11-09T00:00:00.000Z'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(now)
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  outbox = new EffectOutbox({ db, store, epoch: 'current' })
})
afterEach(async () => {
  await outbox.stop()
  db.close()
  vi.useRealTimers()
})

it('recovers each orphan answer once, keeps current-epoch leases, and audits retirement', async () => {
  for (const key of ['retry', 'done', 'retire', 'current']) {
    store.transaction('seed', () =>
      store.enqueueEffect({
        missionId: key,
        kind: 'verification.enqueue',
        key,
        payload: { runId: key },
        dueAt: now
      })
    )
    store.leaseDueEffect({
      missionId: key,
      kind: 'verification.enqueue',
      now,
      epoch: key === 'current' ? 'current' : 'old'
    })
  }
  const execute = vi.fn(() => 'done' as const)
  const onOrphan = vi.fn((effect: EffectOf<'verification.enqueue'>) => {
    expect(db.db.isTransaction).toBe(false)
    if (effect.key === 'retire') {
      return { retire: 'dispatch_outcome_unknown' }
    }
    return effect.key === 'done' ? ('done' as const) : ('retry' as const)
  })
  outbox.register('verification.enqueue', { execute, onOrphan, maxAttempts: 1, backoffMs: [] })
  const recovery = outbox.recoverAtBoot()
  expect(outbox.recoverAtBoot()).toBe(recovery)
  await recovery
  expect(onOrphan).toHaveBeenCalledTimes(3)
  expect(execute).not.toHaveBeenCalled()
  expect(store.getEffect('verification.enqueue', 'retry')).toMatchObject({
    status: 'pending',
    attempts: 0,
    dueAt: now,
    leaseEpoch: null
  })
  expect(store.getEffect('verification.enqueue', 'done')?.status).toBe('done')
  expect(store.getEffect('verification.enqueue', 'current')?.status).toBe('running')
  const retired = store.getEffect('verification.enqueue', 'retire')
  expect(retired).toMatchObject({ status: 'retired', lastError: 'dispatch_outcome_unknown' })
  expect(store.listAuditEvents({ missionId: 'retire' })).toEqual([
    {
      sequence: 1,
      missionId: 'retire',
      actor: 'EffectOutbox',
      objectKind: 'effect',
      objectId: retired?.id,
      event: 'effect.retired',
      before: null,
      after: { kind: 'verification.enqueue', key: 'retire', reason: 'dispatch_outcome_unknown' },
      createdAt: now
    }
  ])
  await outbox.recoverAtBoot()
  expect(onOrphan).toHaveBeenCalledTimes(3)
  outbox.start()
  await outbox.kick()
  expect(execute).toHaveBeenCalledTimes(1)
  expect(store.getEffect('verification.enqueue', 'retry')?.status).toBe('done')
})

it('preserves an orphan and its evidence when retirement auditing fails', async () => {
  const effect = store.transaction('seed', () =>
    store.enqueueEffect({
      missionId: 'mission',
      kind: 'verification.enqueue',
      key: 'run',
      payload: { runId: 'run' },
      dueAt: now
    })
  )
  store.leaseDueEffect({ missionId: 'mission', kind: 'verification.enqueue', now, epoch: 'old' })
  outbox.register('verification.enqueue', {
    execute: () => 'done',
    onOrphan: () => ({ retire: 'unknown' }),
    maxAttempts: 1,
    backoffMs: []
  })
  const audit = vi.spyOn(store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  await expect(outbox.recoverAtBoot()).rejects.toThrow('audit unavailable')
  expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
    id: effect.id,
    status: 'running',
    leaseEpoch: 'old'
  })
  audit.mockRestore()
})

it.each([false, true])(
  'waits for orphan recovery before shutdown (started: %s)',
  async (started) => {
    store.transaction('seed', () =>
      store.enqueueEffect({
        missionId: 'mission',
        kind: 'verification.enqueue',
        key: 'run',
        payload: { runId: 'run' },
        dueAt: now
      })
    )
    store.leaseDueEffect({ missionId: 'mission', kind: 'verification.enqueue', now, epoch: 'old' })
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    outbox.register('verification.enqueue', {
      execute: () => 'done',
      onOrphan: async () => {
        entered.resolve()
        await release.promise
        return 'done' as const
      },
      maxAttempts: 1,
      backoffMs: []
    })
    const recovery = outbox.recoverAtBoot()
    await entered.promise
    if (started) {
      outbox.start()
      await Promise.resolve()
    }
    const finished = vi.fn()
    const stopped = outbox.stop().then(finished)
    try {
      await Promise.resolve()
      expect(finished).not.toHaveBeenCalled()
      expect(store.getEffect('verification.enqueue', 'run')?.status).toBe('running')
    } finally {
      release.resolve()
      await Promise.all([recovery, stopped])
    }
    expect(finished).toHaveBeenCalledTimes(1)
    expect(store.getEffect('verification.enqueue', 'run')?.status).toBe('done')
  }
)
