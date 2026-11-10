import type { AxiomStore } from '../db/axiom-store'
import type { Scheduler } from '../scheduler/scheduler'
import type { EffectOutbox } from './effect-outbox'
import { appendEffectAudit } from './effect-execution'

export function registerAttemptContinuation(deps: {
  store: AxiomStore
  effects: EffectOutbox
  scheduler: Pick<Scheduler, 'scheduleRound'>
}): void {
  const { store, effects, scheduler } = deps
  effects.register('attempt.continue', {
    execute: async (effect): Promise<'done'> => {
      const { taskId, seq } = effect.payload
      const task = store.getTaskStage(taskId)
      if (
        store.getMission(effect.missionId)?.status === 'EXECUTING' &&
        task?.stage === 'READY' &&
        task.missionId === effect.missionId &&
        store.nextAttemptSeq(taskId) <= seq + 1
      ) {
        await scheduler.scheduleRound(effect.missionId, 'stage_change')
      }
      return 'done'
    },
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry'
  })
}

/** The caller's task-adjust transaction owns both retirement and its audit. */
export function retireTaskContinuation(store: AxiomStore, taskId: string): void {
  for (const effect of store.listEffects({ status: 'pending' })) {
    if (effect.kind !== 'attempt.continue' || effect.payload.taskId !== taskId) {
      continue
    }
    const reason = 'superseded_by_task_adjust'
    const retired = store.retireEffect({
      id: effect.id,
      expectedStatus: 'pending',
      expectedLeaseEpoch: effect.leaseEpoch,
      reason
    })
    if (retired) {
      appendEffectAudit(store, retired, 'effect.retired', {
        kind: retired.kind,
        key: retired.key,
        reason
      })
    }
  }
}
