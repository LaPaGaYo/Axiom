import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { MessageRow } from '../../runtime/orchestration/types'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from './mission-controller'

export type AxiomRuntime = Pick<OrcaRuntimeService, 'getOrchestrationDb' | 'waitForMessage'>
type ConsumerIdentity = { missionId: string; runId: string; consumerGeneration: number }

export class RunMailboxConsumer {
  private abort: AbortController | undefined

  constructor(
    private readonly runtime: AxiomRuntime,
    private readonly store: AxiomStore,
    private readonly missions: MissionController,
    private readonly identity: ConsumerIdentity
  ) {}

  async start(): Promise<'stopped' | 'waiter_exists'> {
    if (this.abort) {
      return 'stopped'
    }
    this.abort = new AbortController()
    const signal = this.abort.signal
    try {
      while (!signal.aborted) {
        const iteration = new AbortController()
        try {
          // Register before reading durable backlog. A resolved exclusive rejection
          // must be observed before any effects; a pending waiter means admission.
          const waiting = this.runtime.waitForMessage(`run:${this.identity.runId}`, {
            exclusive: true,
            timeoutMs: 30_000,
            signal: AbortSignal.any([signal, iteration.signal])
          })
          const admission = await Promise.race([waiting, Promise.resolve('registered' as const)])
          if (admission === 'waiter_exists') {
            return 'waiter_exists'
          }
          if (admission === 'cancelled' || signal.aborted) {
            break
          }
          this.drain()
          if ((await waiting) === 'cancelled') {
            break
          }
        } catch (error) {
          iteration.abort()
          if (signal.aborted) {
            break
          }
          // Log identities and the classified failure, never message bodies or
          // arbitrary handler exception text (which could contain credentials).
          const fenced = error instanceof OrchestrationError && error.code === 'consumer_fenced'
          console.warn('[axiom] Run mailbox consumer failed', {
            ...this.identity,
            reason: fenced ? 'consumer_fenced' : 'handler_error'
          })
          if (fenced) {
            this.blockFencedMission()
            break
          }
          // ponytail: fixed 250ms backoff for M1; M2 owns bounded retry/escalation policy.
          // An empty type filter keeps notifications from bypassing the backoff.
          const backoff = await this.runtime.waitForMessage(`run:${this.identity.runId}`, {
            exclusive: true,
            typeFilter: [],
            timeoutMs: 250,
            signal
          })
          if (backoff === 'waiter_exists') {
            return 'waiter_exists'
          }
          if (backoff === 'cancelled') {
            break
          }
        } finally {
          iteration.abort()
        }
      }
      return 'stopped'
    } finally {
      this.stop()
    }
  }

  stop(): void {
    this.abort?.abort()
  }

  drain(): void {
    const db = this.runtime.getOrchestrationDb()
    while (!this.abort?.signal.aborted) {
      const mission = this.missions.getMission(this.identity.missionId)
      if (
        TERMINAL_MISSION_STATUSES.has(mission.status) ||
        mission.status === 'PAUSED' ||
        mission.status === 'BLOCKED'
      ) {
        this.stop()
        return
      }
      // Keep the generation captured at start: rereading it here would let a
      // displaced consumer silently adopt somebody else's authority.
      const batch = db.getOrCreateRunDelivery(this.identity)
      if (!batch) {
        return
      }
      this.handle(batch.messages)
      db.acknowledgeRunDelivery({ ...this.identity, deliveryId: batch.delivery.id })
    }
  }

  handle(messages: readonly MessageRow[]): void {
    this.store.transaction('mailbox_message_batch', () => {
      // ponytail: scan Mission audit history once per batch in M1; M2 can add
      // an indexed audit lookup when message volume justifies the migration.
      const seen = new Set(
        this.store
          .listAuditEvents({ missionId: this.identity.missionId })
          .filter((event) => event.event === 'mailbox.message')
          .map((event) => event.objectId)
      )
      for (const message of messages) {
        if (seen.has(message.id)) {
          continue
        }
        this.store.appendAuditEvent({
          missionId: this.identity.missionId,
          actor: 'MissionController',
          objectKind: 'message',
          objectId: message.id,
          event: 'mailbox.message',
          before: null,
          after: { runId: this.identity.runId, type: message.type }
        })
        seen.add(message.id)
      }
      this.missions.recomputeReadiness(this.identity.missionId)
    })
  }

  private blockFencedMission(): void {
    this.store.transaction('mailbox_consumer_fenced', () => {
      const mission = this.missions.getMission(this.identity.missionId)
      if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
        return
      }
      if (mission.status !== 'BLOCKED') {
        this.missions.blockMission(mission.id, 'consumer_fenced')
      }
      this.store.appendAuditEvent({
        missionId: mission.id,
        actor: 'MissionController',
        objectKind: 'mission',
        objectId: mission.id,
        event: 'mailbox.consumer_fenced',
        before: null,
        after: {
          runId: this.identity.runId,
          consumerGeneration: this.identity.consumerGeneration,
          reason: 'consumer_fenced'
        }
      })
    })
  }
}
