import { z } from 'zod'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import {
  EffectKindSchema,
  type Effect,
  type EffectKind,
  type EnqueueEffect
} from '../../../shared/axiom-contract/effects'
import {
  bindEffectExecutor,
  executeEffect,
  recoverEffect,
  type EffectExecutor
} from './effect-execution'
export type { EffectExecutor, EffectExecutionResult, EffectOrphanResult } from './effect-execution'

type OutboxDependencies = { db: OrchestrationDb; store: AxiomStore; epoch: string }
type Flight = PromiseWithResolvers<void> & { failure?: { error: unknown } }
function laneKey(effect: Pick<Effect, 'kind' | 'missionId'>): string {
  return JSON.stringify([effect.kind, effect.missionId])
}

export class EffectOutbox {
  private readonly executors = new Map<EffectKind, EffectExecutor<EffectKind>>()
  private readonly activeLanes = new Set<string>()
  private enabled = false
  private scheduled = false
  private flight?: Flight
  private recovery?: Promise<void>
  private timer?: ReturnType<typeof setTimeout>

  constructor(private readonly deps: OutboxDependencies) {
    z.string().min(1).parse(deps.epoch)
  }

  register<K extends EffectKind>(kind: K, executor: EffectExecutor<K>): void {
    EffectKindSchema.parse(kind)
    if (this.executors.has(kind)) {
      throw new Error(`Effect executor already registered: ${kind}`)
    }
    this.executors.set(kind, bindEffectExecutor(kind, executor))
  }

  enqueue(input: EnqueueEffect): Effect {
    const effect = this.deps.store.enqueueEffect(input)
    queueMicrotask(() => this.wake())
    return effect
  }

  start(): void {
    this.enabled = true
    this.wake()
  }

  async stop(): Promise<void> {
    this.enabled = false
    this.clearTimer()
    // A scan paused for recovery may own a flight with no active execution to wake it.
    this.scheduleScan()
    const pending = await Promise.allSettled([this.flight?.promise, this.recovery])
    for (const result of pending) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
  }

  kick(): Promise<void> {
    if (!this.enabled) {
      return Promise.resolve()
    }
    this.flight ??= Promise.withResolvers<void>()
    this.scheduleScan()
    return this.flight.promise
  }

  recoverAtBoot(): Promise<void> {
    if (this.recovery) {
      return this.recovery
    }
    this.recovery = Promise.resolve()
      .then(async () => {
        if (this.deps.db.db.isTransaction) {
          throw new Error('Effect recovery requires a committed transaction')
        }
        let failure: { error: unknown } | undefined
        for (const effect of this.deps.store.listOrphanedEffects(this.deps.epoch)) {
          try {
            const executor = this.executors.get(effect.kind)
            if (!executor) {
              throw new Error(`Missing effect executor: ${effect.kind}`)
            }
            await recoverEffect(this.deps.store, effect, executor)
          } catch (error) {
            // The unchanged lease closes only its lane; other Missions can still recover.
            failure ??= { error }
          }
        }
        if (failure) {
          throw failure.error
        }
      })
      .finally(() => {
        this.recovery = undefined
        if (this.enabled) {
          this.wake()
        }
      })
    return this.recovery
  }

  private wake(): void {
    void this.kick().catch(() => console.warn('[axiom] Effect outbox drain incomplete'))
  }

  private scheduleScan(): void {
    if (this.scheduled) {
      return
    }
    this.scheduled = true
    queueMicrotask(() => this.scan())
  }

  private scan(): void {
    this.scheduled = false
    this.clearTimer()
    try {
      // Caller transactions are synchronous; a manually held transaction must be kicked after commit.
      if (this.enabled && !this.recovery && !this.deps.db.db.isTransaction) {
        this.launchDueLanes()
      }
    } catch (error) {
      if (this.flight) {
        this.flight.failure = { error }
      }
    }
    if (this.activeLanes.size || this.scheduled || (this.enabled && this.recovery)) {
      return
    }
    const finished = this.flight
    this.flight = undefined
    if (finished?.failure) {
      finished.reject(finished.failure.error)
    } else {
      finished?.resolve()
    }
  }

  private launchDueLanes(): void {
    const { store, epoch } = this.deps
    const now = new Date().toISOString()
    // ponytail: v0 scans pending/running rows; indexed lane queries can replace this if queues grow.
    const pending = store.listEffects({ status: 'pending' })
    const running = new Set(store.listEffects({ status: 'running' }).map(laneKey))
    for (const item of pending) {
      if (!this.enabled) {
        break
      }
      const lane = laneKey(item)
      const executor = this.executors.get(item.kind)
      if (!executor || this.activeLanes.has(lane) || running.has(lane) || item.dueAt > now) {
        continue
      }
      const effect = store.leaseDueEffect({
        kind: item.kind,
        missionId: item.missionId,
        now,
        epoch
      })
      if (!effect) {
        continue
      }
      this.activeLanes.add(lane)
      // Each lane's completion schedules another scan; no all-lane barrier can hold new work.
      void executeEffect(store, effect, executor)
        .catch((error: unknown) => {
          if (this.flight) {
            this.flight.failure = { error }
          }
        })
        .finally(() => {
          this.activeLanes.delete(lane)
          this.scheduleScan()
        })
    }
    const future = pending
      .filter(
        (effect) =>
          this.executors.has(effect.kind) &&
          !this.activeLanes.has(laneKey(effect)) &&
          !running.has(laneKey(effect)) &&
          effect.dueAt > now
      )
      .map((effect) => Date.parse(effect.dueAt))
    if (this.enabled && future.length) {
      this.timer = setTimeout(
        () => {
          this.timer = undefined
          this.wake()
        },
        Math.min(Math.min(...future) - Date.now(), 2_147_483_647)
      )
      this.timer.unref()
    }
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
    }
    this.timer = undefined
  }
}
