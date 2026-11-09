import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from '../db/axiom-store'
import { EffectOutbox } from './effect-outbox'
import type { EffectOf } from '../../../shared/axiom-contract/effects'
import { MissionController } from '../mission-controller/mission-controller'
import { createInput } from '../mission-controller/controller-fixture.test-support'

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
  vi.restoreAllMocks()
})

function queueVerification(missionId: string, key: string) {
  return store.transaction('seed', () =>
    store.enqueueEffect({ missionId, kind: 'verification.enqueue', key, payload: { runId: key } })
  )
}

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

it('recovers the remaining orphans when one recovery fails', async () => {
  const controller = new MissionController(db, store)
  const blocked = controller.createMission(createInput).mission.id
  const healthy = controller.createMission(createInput).mission.id
  queueVerification(blocked, 'blocked')
  queueVerification(healthy, 'healthy')
  const original = store.leaseDueEffect({
    missionId: blocked,
    kind: 'verification.enqueue',
    now,
    epoch: 'old'
  })
  store.leaseDueEffect({ missionId: healthy, kind: 'verification.enqueue', now, epoch: 'old' })
  queueVerification(blocked, 'blocked-next')
  queueVerification(healthy, 'healthy-next')
  const failure = new Error('first orphan unavailable')
  const execute = vi.fn((_effect: EffectOf<'verification.enqueue'>) => 'done' as const)
  const onOrphan = vi.fn((effect: EffectOf<'verification.enqueue'>) => {
    if (effect.missionId === blocked) {
      throw failure
    }
    return 'retry' as const
  })
  outbox.register('verification.enqueue', { execute, onOrphan, maxAttempts: 1, backoffMs: [] })
  const rejected = vi.fn()
  const recovery = outbox.recoverAtBoot()
  expect(outbox.recoverAtBoot()).toBe(recovery)
  await recovery.catch(rejected)
  expect(rejected).toHaveBeenCalledExactlyOnceWith(failure)
  expect(onOrphan).toHaveBeenCalledTimes(2)
  expect(original).toMatchObject({ status: 'running', leaseEpoch: 'old' })
  expect(store.getEffect('verification.enqueue', 'blocked')).toEqual(original)
  expect(store.getEffect('verification.enqueue', 'healthy')).toMatchObject({
    status: 'pending',
    leaseEpoch: null,
    attempts: 0,
    dueAt: now
  })
  expect(
    store.leaseDueEffect({
      missionId: blocked,
      kind: 'verification.enqueue',
      now,
      epoch: 'current'
    })
  ).toBeUndefined()
  const leased = store.leaseDueEffect({
    missionId: healthy,
    kind: 'verification.enqueue',
    now,
    epoch: 'current'
  })
  expect(leased).toMatchObject({ key: 'healthy', status: 'running', leaseEpoch: 'current' })
  if (!leased) {
    throw new Error('Missing healthy lane lease')
  }
  store.completeEffect({ id: leased.id, expectedStatus: 'running', expectedLeaseEpoch: 'current' })
  outbox.start()
  await outbox.kick()
  expect(execute.mock.calls.map(([effect]) => effect.key)).toEqual(['healthy-next'])
  expect(store.getEffect('verification.enqueue', 'blocked')).toEqual(original)
  expect(store.getEffect('verification.enqueue', 'blocked-next')?.status).toBe('pending')
  onOrphan.mockImplementation(() => 'retry')
  await outbox.recoverAtBoot()
  await outbox.kick()
  expect(onOrphan).toHaveBeenCalledTimes(3)
  expect(execute.mock.calls.map(([effect]) => effect.key)).toEqual([
    'healthy-next',
    'blocked',
    'blocked-next'
  ])
  expect(store.listEffects({}).every((effect) => effect.status === 'done')).toBe(true)
  expect(store.getEffect('verification.enqueue', 'blocked')?.attempts).toBe(0)
})

it('preserves missing-executor leases and recovers other kinds before rejecting', async () => {
  const missing = store.transaction('seed', () =>
    store.enqueueEffect({
      missionId: 'missing',
      kind: 'attempt.dispatch',
      key: 'task/1',
      payload: {
        taskId: 'task',
        seq: 1,
        branch: 'branch',
        agentSpecId: 'spec',
        contextPackageId: 'context'
      }
    })
  )
  const original = store.leaseDueEffect({
    missionId: missing.missionId,
    kind: missing.kind,
    now,
    epoch: 'old'
  })
  queueVerification('healthy', 'healthy')
  store.leaseDueEffect({ missionId: 'healthy', kind: 'verification.enqueue', now, epoch: 'old' })
  outbox.register('verification.enqueue', {
    execute: () => 'done',
    onOrphan: () => 'done',
    maxAttempts: 1,
    backoffMs: []
  })
  await expect(outbox.recoverAtBoot()).rejects.toThrow('Missing effect executor: attempt.dispatch')
  expect(store.getEffect(missing.kind, missing.key)).toEqual(original)
  expect(store.getEffect('verification.enqueue', 'healthy')?.status).toBe('done')
})

it('rejects with the first error after recovering past multiple rejected handlers', async () => {
  for (const key of ['first', 'second', 'healthy']) {
    queueVerification(key, key)
    store.leaseDueEffect({ missionId: key, kind: 'verification.enqueue', now, epoch: 'old' })
  }
  const originals = store.listOrphanedEffects('current')
  const first = new Error('first failure')
  const onOrphan = vi.fn(async (effect: EffectOf<'verification.enqueue'>) => {
    if (effect.key !== 'healthy') {
      throw effect.key === 'first' ? first : new Error('second failure')
    }
    return 'done' as const
  })
  outbox.register('verification.enqueue', {
    execute: () => 'done',
    onOrphan,
    maxAttempts: 1,
    backoffMs: []
  })
  await expect(outbox.recoverAtBoot()).rejects.toBe(first)
  expect(onOrphan).toHaveBeenCalledTimes(3)
  expect(store.listOrphanedEffects('current')).toEqual(originals.slice(0, 2))
  expect(store.getEffect('verification.enqueue', 'healthy')?.status).toBe('done')
})

it.each(['done', 'retry', 'retire'] as const)(
  'continues recovery after a %s store write fails without changing the orphan',
  async (answer) => {
    for (const key of ['blocked', 'healthy']) {
      queueVerification(key, key)
      store.leaseDueEffect({ missionId: key, kind: 'verification.enqueue', now, epoch: 'old' })
    }
    const original = store.getEffect('verification.enqueue', 'blocked')
    db.db.exec(`CREATE TRIGGER reject_effect_recovery AFTER UPDATE ON axiom_effects
      WHEN OLD.effect_key = 'blocked'
      BEGIN SELECT RAISE(ABORT, 'effect write unavailable'); END`)
    outbox.register('verification.enqueue', {
      execute: () => 'done',
      onOrphan: () => (answer === 'retire' ? { retire: 'unknown' } : answer),
      maxAttempts: 1,
      backoffMs: []
    })
    await expect(outbox.recoverAtBoot()).rejects.toThrow('effect write unavailable')
    expect(store.getEffect('verification.enqueue', 'blocked')).toEqual(original)
    expect(store.getEffect('verification.enqueue', 'healthy')?.status).toBe(
      answer === 'retire' ? 'retired' : answer === 'retry' ? 'pending' : 'done'
    )
  }
)

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
