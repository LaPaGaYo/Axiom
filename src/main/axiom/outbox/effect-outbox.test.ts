import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from '../db/axiom-store'
import { EffectOutbox } from './effect-outbox'
import type { EffectOf } from '../../../shared/axiom-contract/effects'

let db: OrchestrationDb
let store: AxiomStore
let outbox: EffectOutbox
const instant = '2026-11-09T00:00:00.000Z'
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  vi.setSystemTime(instant)
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  outbox = new EffectOutbox({ db, store, epoch: 'current' })
})
afterEach(async () => {
  await outbox.stop()
  db.close()
  vi.useRealTimers()
})
function enqueue(key = 'run', missionId = 'mission', dueAt?: string) {
  return store.transaction('effect_test_enqueue', () =>
    outbox.enqueue({
      missionId,
      kind: 'verification.enqueue',
      key,
      payload: { runId: key },
      dueAt
    })
  )
}
function dispatch(key: string, missionId: string) {
  return store.transaction('effect_test_dispatch', () =>
    outbox.enqueue({
      missionId,
      kind: 'attempt.dispatch',
      key,
      payload: {
        taskId: key,
        seq: 1,
        branch: `axiom/attempt/${key}/1`,
        agentSpecId: 'spec',
        contextPackageId: 'context'
      }
    })
  )
}
function register(
  execute: (
    effect: EffectOf<'verification.enqueue'>
  ) => 'done' | { later: string } | Promise<'done' | { later: string }>
) {
  outbox.register('verification.enqueue', {
    execute,
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry'
  })
}

describe('effect outbox execution', () => {
  it('requires caller transactions and never executes rolled-back work', async () => {
    const execute = vi.fn(() => 'done' as const)
    register(execute)
    outbox.start()
    expect(() =>
      outbox.enqueue({
        missionId: 'mission',
        kind: 'verification.enqueue',
        key: 'run',
        payload: { runId: 'run' }
      })
    ).toThrow(/transaction/i)
    expect(() =>
      store.transaction('roll_back', () => {
        outbox.enqueue({
          missionId: 'mission',
          kind: 'verification.enqueue',
          key: 'run',
          payload: { runId: 'run' }
        })
        throw new Error('roll back')
      })
    ).toThrow('roll back')
    await outbox.kick()
    expect(execute).not.toHaveBeenCalled()
    expect(store.listEffects({})).toEqual([])
  })
  it('executes after commit outside transactions and coalesces kicks until drained in due/insertion order', async () => {
    const seen: string[] = []
    const gate = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    register(async (effect) => {
      expect(db.db.isTransaction).toBe(false)
      seen.push(effect.payload.runId)
      if (effect.key === 'first') {
        entered.resolve()
        await gate.promise
      }
      return 'done' as const
    })
    enqueue('second', 'mission', instant)
    enqueue('first', 'mission', '2026-11-08T00:00:00.000Z')
    enqueue('third')
    outbox.start()
    const firstKick = outbox.kick()
    expect(outbox.kick()).toBe(firstKick)
    await entered.promise
    expect(seen).toEqual(['first'])
    expect(store.listEffects({ status: 'running' })).toHaveLength(1)
    gate.resolve()
    await firstKick
    expect(seen).toEqual(['first', 'second', 'third'])
    expect(store.listEffects({ status: 'done' })).toHaveLength(3)
  })
  it('starts independent kind/Mission lanes including newly queued lanes while another launch hangs', async () => {
    const blocked = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const otherStarted = Promise.withResolvers<void>()
    const verified = Promise.withResolvers<void>()
    const seen: string[] = []
    outbox.register('attempt.dispatch', {
      maxAttempts: 1,
      backoffMs: [],
      onOrphan: () => 'retry',
      execute: async (effect) => {
        seen.push(effect.key)
        if (effect.key === 'blocked') {
          entered.resolve()
          await blocked.promise
        }
        if (effect.key === 'new-mission') {
          otherStarted.resolve()
        }
        return 'done' as const
      }
    })
    register(() => {
      verified.resolve()
      return 'done'
    })
    dispatch('blocked', 'one')
    dispatch('same-lane', 'one')
    outbox.start()
    const flight = outbox.kick()
    await entered.promise
    dispatch('new-mission', 'two')
    enqueue('parallel-kind', 'one')
    await Promise.all([otherStarted.promise, verified.promise])
    expect(seen).toEqual(['blocked', 'new-mission'])
    expect(store.getEffect('attempt.dispatch', 'same-lane')?.status).toBe('pending')
    blocked.resolve()
    await flight
    expect(seen).toEqual(['blocked', 'new-mission', 'same-lane'])
  })
  it('defers without consuming attempts and wakes itself with one unref timer at the earliest due time', async () => {
    let calls = 0
    const execute = vi.fn((effect: EffectOf<'verification.enqueue'>) =>
      effect.attempts === 0 && ++calls === 1
        ? { later: '2026-11-09T00:00:01.000Z' }
        : ('done' as const)
    )
    const timer = vi.spyOn(globalThis, 'setTimeout')
    register(execute)
    enqueue()
    enqueue('future', 'other', '2026-11-09T00:00:02.000Z')
    outbox.start()
    await outbox.kick()
    expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
      status: 'pending',
      attempts: 0,
      dueAt: '2026-11-09T00:00:01.000Z'
    })
    expect(vi.getTimerCount()).toBe(1)
    expect(timer.mock.results.at(-1)?.value.hasRef()).toBe(false)
    await vi.advanceTimersByTimeAsync(999)
    expect(execute).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
      status: 'done',
      attempts: 0
    })
    expect(vi.getTimerCount()).toBe(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getEffect('verification.enqueue', 'future')?.status).toBe('done')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('retries with configured backoff then records one atomic sanitized failure and exhausted hook', async () => {
    const secret = `sk-${'x'.repeat(30)}`
    const safeError = `failure [REDACTED] ${'long '.repeat(500)}`.slice(0, 2000)
    const onExhausted = vi.fn((effect: EffectOf<'verification.enqueue'>) => {
      expect(db.db.isTransaction).toBe(false)
      expect(effect).toMatchObject({ status: 'failed', attempts: 3, lastError: safeError })
      expect(store.listAuditEvents({ missionId: 'mission' })).toHaveLength(1)
    })
    const execute = vi.fn(() => {
      throw new Error(`failure ${secret} ${'long '.repeat(500)}`)
    })
    outbox.register('verification.enqueue', {
      execute,
      maxAttempts: 3,
      backoffMs: [1000, 5000],
      onExhausted,
      onOrphan: () => 'retry'
    })
    const row = enqueue()
    outbox.start()
    await outbox.kick()
    expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
      status: 'pending',
      attempts: 1,
      dueAt: '2026-11-09T00:00:01.000Z'
    })
    await vi.advanceTimersByTimeAsync(1000)
    expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
      status: 'pending',
      attempts: 2,
      dueAt: '2026-11-09T00:00:06.000Z'
    })
    await vi.advanceTimersByTimeAsync(5000)
    await outbox.kick()
    expect(execute).toHaveBeenCalledTimes(3)
    expect(onExhausted).toHaveBeenCalledTimes(1)
    expect(store.listAuditEvents({ missionId: 'mission' })).toEqual([
      {
        sequence: 1,
        missionId: 'mission',
        actor: 'EffectOutbox',
        objectKind: 'effect',
        objectId: row.id,
        event: 'effect.failed',
        before: null,
        after: { kind: 'verification.enqueue', key: 'run', attempts: 3, lastError: safeError },
        createdAt: '2026-11-09T00:00:06.000Z'
      }
    ])
    expect(JSON.stringify(store.listEffects({}))).not.toContain(secret)
  })
  it('keeps the failed update rolled back if its audit cannot persist', async () => {
    const exhausted = vi.fn()
    outbox.register('verification.enqueue', {
      execute: () => {
        throw new Error('failure')
      },
      maxAttempts: 1,
      backoffMs: [],
      onExhausted: exhausted,
      onOrphan: () => 'retry'
    })
    const audit = vi.spyOn(store, 'appendAuditEvent').mockImplementation(() => {
      throw new Error('audit unavailable')
    })
    enqueue()
    outbox.start()
    await expect(outbox.kick()).rejects.toThrow('audit unavailable')
    expect(store.getEffect('verification.enqueue', 'run')).toMatchObject({
      status: 'running',
      attempts: 0
    })
    expect(exhausted).not.toHaveBeenCalled()
    audit.mockRestore()
  })
  it('stop clears the timer, waits for active work, and prevents new work until start', async () => {
    const release = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    const execute = vi.fn(async () => {
      entered.resolve()
      await release.promise
      return 'done' as const
    })
    register(execute)
    enqueue()
    enqueue('future', 'other', '2026-11-09T00:00:01.000Z')
    outbox.start()
    await entered.promise
    const stopped = outbox.stop()
    expect(vi.getTimerCount()).toBe(0)
    enqueue('after-stop', 'third')
    await outbox.kick()
    expect(execute).toHaveBeenCalledTimes(1)
    release.resolve()
    await stopped
    expect(store.getEffect('verification.enqueue', 'run')?.status).toBe('done')
    await vi.advanceTimersByTimeAsync(2000)
    expect(execute).toHaveBeenCalledTimes(1)
    outbox.start()
    await outbox.kick()
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('honors stop immediately when an executor stops the outbox during a scan', async () => {
    const execute = vi.fn(() => {
      void outbox.stop()
      return 'done' as const
    })
    register(execute)
    enqueue('first')
    enqueue('second', 'other')
    outbox.start()
    await outbox.kick()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(store.getEffect('verification.enqueue', 'second')?.status).toBe('pending')
  })
})
