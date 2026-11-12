import type { AttemptFailure } from '../../../shared/axiom-contract/attempt-failure'
import type { AttemptContinuePayloadSchema } from '../../../shared/axiom-contract/effects'
import type { z } from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { EffectOutbox } from '../outbox/effect-outbox'
import { routeWorkerMessage } from '../messaging/message-router'
import { INTERRUPTION_CHAIN_LIMIT, interruptionDueAt } from './interruption-policy'

/** Called inside exit settlement, after kernel failure; latest binding guards prevent double refunds. */
export function settleInterruptedAttempt(
  ctx: {
    db: OrchestrationDb
    store: AxiomStore
    missions: MissionController
    runtime: OrcaRuntimeService
    effects: Pick<EffectOutbox, 'enqueue'>
  },
  input: {
    taskId: string
    seq: number
    dispatchId: string
    actor: string
    failure: AttemptFailure
    account?: z.infer<typeof AttemptContinuePayloadSchema>['account']
    now: number
    resumeRefused?: boolean
  }
): { settled: boolean } {
  const { store, missions, db, runtime, effects } = ctx
  return store.transaction('settle_interrupted_attempt', () => {
    const task = store.getTaskStage(input.taskId)
    const binding = store.getAttemptBinding(input.taskId, input.seq)
    if (
      task?.stage !== 'RUNNING' ||
      binding?.dispatchId !== input.dispatchId ||
      store.nextAttemptSeq(input.taskId) !== input.seq + 1 ||
      store.getSubmissionByDispatch(input.dispatchId)
    ) {
      return { settled: false }
    }
    const previous = store.getEffect('attempt.continue', `${input.taskId}/${input.seq - 1}`)
    const previousChain = previous?.kind === 'attempt.continue' ? previous.payload.chain : 0
    const chain = input.resumeRefused ? Math.max(1, previousChain) : 1 + previousChain
    missions.transitionTaskStage({
      taskId: input.taskId,
      to: 'NEEDS_FIX',
      reason: 'interrupted',
      actor: input.actor,
      attemptCountDelta: -1
    })
    if (input.resumeRefused || (input.failure.retryable && chain < INTERRUPTION_CHAIN_LIMIT)) {
      missions.transitionTaskStage({
        taskId: input.taskId,
        to: 'READY',
        reason: 'retry_after_interruption',
        actor: input.actor
      })
      effects.enqueue({
        missionId: task.missionId,
        kind: 'attempt.continue',
        key: `${input.taskId}/${input.seq}`,
        dueAt: input.resumeRefused
          ? new Date(input.now).toISOString()
          : interruptionDueAt(input.failure, chain, input.now),
        payload: {
          taskId: input.taskId,
          seq: input.seq,
          chain,
          failureClass: input.failure.class,
          ...(input.account ? { account: input.account } : {}),
          ...(input.failure.resetsAt ? { resetsAt: input.failure.resetsAt } : {})
        }
      })
    } else {
      missions.transitionTaskStage({
        taskId: input.taskId,
        to: 'BLOCKED',
        reason: 'environment',
        actor: input.actor
      })
      const dispatch = db.getDispatchContextById(input.dispatchId)
      if (!dispatch) {
        throw new Error('Interrupted Attempt dispatch missing')
      }
      routeWorkerMessage(
        { runtime, db, store },
        {
          sender: {
            address: `dispatch:${input.dispatchId}`,
            terminalHandle: dispatch.assignee_handle,
            paneKey: dispatch.assignee_pane_key,
            orcaSessionId: dispatch.assignee_orca_session_id
          },
          axiom: {
            version: 1,
            type: 'BLOCKED',
            missionId: task.missionId,
            taskId: task.taskId,
            attemptId: input.dispatchId,
            summary: `Attempt ${input.seq} interrupted by ${input.failure.class} (${chain} consecutive interruptions)`,
            artifactIds: [],
            related: { taskIds: [task.taskId] },
            blocked: { reason: 'environment', paths: [] }
          }
        }
      )
    }
    return { settled: true }
  })
}
