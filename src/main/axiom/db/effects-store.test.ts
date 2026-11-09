import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'

let db: OrchestrationDb
let store: AxiomStore
const now = '2026-11-09T00:00:00.000Z'
const input = {
  missionId: 'mission',
  kind: 'verification.enqueue' as const,
  key: 'run',
  payload: { runId: 'run' },
  dueAt: now
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())
function enqueue(key = 'run', dueAt = now, missionId = 'mission') {
  return store.transaction('enqueue', () =>
    store.enqueueEffect({ ...input, key, dueAt, missionId })
  )
}
function lease(missionId = 'mission', epoch = 'epoch') {
  return store.leaseDueEffect({ kind: 'verification.enqueue', missionId, now, epoch })
}
function fence(effect: { id: string; leaseEpoch: string | null }) {
  return {
    id: effect.id,
    expectedStatus: 'running' as const,
    expectedLeaseEpoch: effect.leaseEpoch
  }
}

describe('effect persistence', () => {
  it('rejects enqueue outside a transaction and rolls back with the caller', () => {
    expect(() => store.enqueueEffect(input)).toThrow(/transaction/i)
    expect(() =>
      store.transaction('rollback', () => {
        store.enqueueEffect(input)
        throw new Error('rollback')
      })
    ).toThrow('rollback')
    expect(store.listEffects({})).toEqual([])
  })
  it.each(['pending', 'failed', 'retired', 'done'] as const)(
    'replaces %s on the same kind/key without adding a row',
    (status) => {
      const first = enqueue()
      db.db
        .prepare(
          'UPDATE axiom_effects SET status = ?, attempts = 2, last_error = ?, lease_epoch = ?'
        )
        .run(status, 'old', 'old-epoch')
      const updated = store.transaction('reenqueue', () =>
        store.enqueueEffect({
          ...input,
          payload: { runId: 'replacement' },
          dueAt: '2026-11-09T01:00:00+01:00'
        })
      )
      expect(updated).toMatchObject({
        id: first.id,
        payload: { runId: 'replacement' },
        status: 'pending',
        attempts: 0,
        dueAt: now,
        leaseEpoch: null,
        lastError: null
      })
      expect(store.listEffects({})).toHaveLength(1)
    }
  )
  it('leaves a running identity and payload untouched on enqueue', () => {
    enqueue()
    const running = lease()
    expect(running).toMatchObject({ status: 'running', leaseEpoch: 'epoch', updatedAt: now })
    expect(
      store.transaction('enqueue_running', () =>
        store.enqueueEffect({ ...input, payload: { runId: 'replacement' } })
      )
    ).toEqual(running)
  })
  it('orders leases by due time then insertion and serializes only a kind/Mission lane', () => {
    enqueue('later', '2026-11-10T00:00:00.000Z')
    const first = enqueue('first')
    enqueue('second')
    enqueue('other', now, 'other-mission')
    expect(lease()).toMatchObject({ id: first.id })
    expect(lease()).toBeUndefined()
    expect(lease('other-mission')).toMatchObject({ key: 'other' })
    expect(store.completeEffect({ ...fence(first), expectedLeaseEpoch: 'epoch' })).toMatchObject({
      status: 'done'
    })
    expect(lease()).toMatchObject({ key: 'second' })
  })
  it('fences every transition by expected status and lease epoch', () => {
    enqueue()
    const running = lease()
    if (!running) {
      throw new Error('missing lease')
    }
    const stale = { ...fence(running), expectedLeaseEpoch: 'stale' }
    expect(store.completeEffect(stale)).toBeUndefined()
    expect(store.deferEffect({ ...stale, dueAt: now })).toBeUndefined()
    expect(
      store.failEffectAttempt({ ...stale, lastError: 'failure', nextDueAt: now })
    ).toBeUndefined()
    expect(store.retireEffect({ ...stale, reason: 'orphan' })).toBeUndefined()
    expect(store.completeEffect({ ...fence(running), expectedStatus: 'pending' })).toBeUndefined()
    expect(store.getEffect('verification.enqueue', 'run')).toEqual(running)
    expect(
      store.deferEffect({ ...fence(running), dueAt: '2026-11-09T02:00:00+02:00' })
    ).toMatchObject({ status: 'pending', attempts: 0, dueAt: now, leaseEpoch: null })
    expect(store.completeEffect(fence(running))).toBeUndefined()
  })
  it('counts thrown failures only and normalizes retry and lease timestamps', () => {
    enqueue()
    const first = lease()
    if (!first) {
      throw new Error('missing lease')
    }
    expect(
      store.failEffectAttempt({
        ...fence(first),
        lastError: 'retry',
        nextDueAt: '2026-11-09T01:00:00+01:00'
      })
    ).toMatchObject({ status: 'pending', attempts: 1, lastError: 'retry', dueAt: now })
    const second = store.leaseDueEffect({
      kind: 'verification.enqueue',
      missionId: 'mission',
      now: '2026-11-09T01:00:00+01:00',
      epoch: 'next'
    })
    if (!second) {
      throw new Error('missing second lease')
    }
    expect(second.updatedAt).toBe(now)
    expect(
      store.failEffectAttempt({ ...fence(second), lastError: 'final', nextDueAt: null })
    ).toMatchObject({ status: 'failed', attempts: 2, lastError: 'final' })
  })
  it('lists insertion order, filters, and only other-epoch running orphans', () => {
    enqueue('z')
    enqueue('a')
    enqueue('other', now, 'other')
    lease('mission', 'old')
    lease('other', 'current')
    expect(store.listEffects({ missionId: 'mission' }).map((effect) => effect.key)).toEqual([
      'z',
      'a'
    ])
    expect(store.listEffects({ status: 'pending' }).map((effect) => effect.key)).toEqual(['a'])
    expect(store.listOrphanedEffects('current').map((effect) => effect.key)).toEqual(['z'])
    const orphan = store.getEffect('verification.enqueue', 'z')
    if (!orphan) {
      throw new Error('missing orphan')
    }
    expect(store.retireEffect({ ...fence(orphan), reason: 'outcome_unknown' })).toMatchObject({
      status: 'retired',
      lastError: 'outcome_unknown',
      attempts: 0
    })
  })
})
