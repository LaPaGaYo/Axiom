import { z } from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { MessageRow } from '../../runtime/orchestration/types'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import { parseAxiomMessagePayload } from '../../../shared/axiom-contract/message-params'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from './mission-controller'
import { projectQuestion } from '../messaging/question-projection'
import { processSubtaskRequest } from '../messaging/subtask-resolution'

export type AxiomRuntime = Pick<OrcaRuntimeService, 'getOrchestrationDb' | 'waitForMessage'>
type ConsumerIdentity = { missionId: string; runId: string; consumerGeneration: number }

export const MAX_CONSECUTIVE_BATCH_FAILURES = 8

export class RunMailboxConsumer {
  private abort: AbortController | undefined

  constructor(
    private readonly runtime: AxiomRuntime,
    private readonly store: AxiomStore,
    private readonly missions: MissionController,
    private readonly identity: ConsumerIdentity,
    private readonly hooks?: { onEscalation?: (missionId: string) => void }
  ) {}

  async start(): Promise<'stopped' | 'waiter_exists'> {
    if (this.abort) {
      return 'stopped'
    }
    this.abort = new AbortController()
    const signal = this.abort.signal
    let failures = 0
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
          failures = 0
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
            this.blockFailedMission('consumer_fenced')
            break
          }
          failures += 1
          if (failures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
            this.blockFailedMission('consumer_retry_exhausted')
            break
          }
          // An empty type filter keeps notifications from bypassing the backoff.
          const backoff = await this.runtime.waitForMessage(`run:${this.identity.runId}`, {
            exclusive: true,
            typeFilter: [],
            timeoutMs: Math.min(250 * 2 ** (failures - 1), 30_000),
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
      if (
        batch.messages.some((message) => {
          if (message.type !== 'escalation') {
            return false
          }
          let payload: unknown
          try {
            payload = JSON.parse(message.payload ?? 'null')
          } catch {
            return false
          }
          const parsed = z.object({ dispatchId: z.string() }).safeParse(payload)
          return (
            parsed.success &&
            this.store.getAttemptBindingByDispatch(parsed.data.dispatchId)?.missionId ===
              this.identity.missionId
          )
        })
      ) {
        this.hooks?.onEscalation?.(this.identity.missionId)
      }
    }
  }

  handle(messages: readonly MessageRow[]): void {
    this.store.transaction('mailbox_message_batch', () => {
      for (const message of messages) {
        if (this.store.hasMessageAudit(this.identity.missionId, message.id)) {
          continue
        }
        const parsed = parseAxiomMessagePayload(message.payload)
        const axiom = parsed?.axiom.missionId === this.identity.missionId ? parsed.axiom : undefined
        const audit = {
          missionId: this.identity.missionId,
          actor: 'MissionController',
          objectKind: 'message',
          objectId: message.id,
          before: null
        }
        const question =
          message.type === 'question' && message.run_id === this.identity.runId
            ? projectQuestion(this.runtime.getOrchestrationDb(), message.id)
            : undefined
        const typed = axiom ?? question
        const after = typed
          ? {
              type: typed.type,
              taskId: typed.taskId,
              attemptId: typed.attemptId,
              messageId: message.id
            }
          : undefined
        this.store.appendAuditEvent({
          ...audit,
          event: typed ? 'message.received' : 'mailbox.message',
          after: after ?? { runId: this.identity.runId, type: message.type }
        })
        if (axiom?.type === 'REQUEST_SUBTASK' && axiom.subtask && after) {
          this.store.appendAuditEvent({
            ...audit,
            event: 'subtask.requested',
            after: { ...after, subtask: axiom.subtask }
          })
          processSubtaskRequest(
            { db: this.runtime.getOrchestrationDb(), store: this.store, missions: this.missions },
            this.identity.missionId,
            message.id
          )
        }
        if (axiom?.type === 'BLOCKED') {
          this.store.appendAuditEvent({
            ...audit,
            event: 'attempt.blocked_reported',
            after: after!
          })
        }
      }
      this.missions.recomputeReadiness(this.identity.missionId)
    })
  }

  private blockFailedMission(reason: 'consumer_fenced' | 'consumer_retry_exhausted'): void {
    this.store.transaction('mailbox_consumer_failed', () => {
      const mission = this.missions.getMission(this.identity.missionId)
      if (TERMINAL_MISSION_STATUSES.has(mission.status)) {
        return
      }
      if (mission.status !== 'BLOCKED') {
        this.missions.blockMission(mission.id, reason)
      }
      this.store.appendAuditEvent({
        missionId: mission.id,
        actor: 'MissionController',
        objectKind: 'mission',
        objectId: mission.id,
        event: reason === 'consumer_fenced' ? 'mailbox.consumer_fenced' : 'mailbox.retry_exhausted',
        before: null,
        after: {
          runId: this.identity.runId,
          consumerGeneration: this.identity.consumerGeneration,
          reason
        }
      })
    })
  }
}
