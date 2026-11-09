import { getMainE2EConfig } from '../../e2e-config'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { AttemptLaunch } from '../scheduler/scheduler'
import type { VerificationService } from '../verification/verification-service'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import type { EffectOutbox } from './effect-outbox'

export function registerMissionEffectExecutors(deps: {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  effects: EffectOutbox
  launch: AttemptLaunch
  verification: Pick<VerificationService, 'kick'>
}): void {
  const { db, store, missions, effects, launch, verification } = deps
  effects.register('attempt.dispatch', {
    execute: async (effect) => {
      const { taskId, seq } = effect.payload
      // Recovered work cannot regain launch authority after a newer Attempt is admitted.
      if (store.nextAttemptSeq(taskId) !== seq + 1) {
        return 'done'
      }
      if (getMainE2EConfig().enabled && process.env.AXIOM_E2E_HOLD_ATTEMPT_DISPATCH === '1') {
        return { later: new Date(Date.now() + 250).toISOString() }
      }
      await launch({ missionId: effect.missionId, ...effect.payload })
      return 'done'
    },
    maxAttempts: 1,
    backoffMs: [],
    onExhausted: (effect) => {
      const { taskId, seq } = effect.payload
      // Preserve the Scheduler's unbound-admission failure behavior and safe audit payload.
      store.appendAuditEvent({
        missionId: effect.missionId,
        actor: 'Scheduler',
        event: 'attempt.launch_failed',
        objectKind: 'attempt',
        objectId: `${taskId}/${seq}`,
        before: null,
        after: { reason: 'launch_rejected' },
        createdAt: new Date().toISOString()
      })
      settleAttemptWithoutSubmission(
        { store, missions },
        { ...effect.payload, dispatchId: null, reason: 'launch_rejected', actor: 'Scheduler' }
      )
    },
    onOrphan: (effect) => {
      const { taskId, seq } = effect.payload
      if (store.getAttemptBinding(taskId, seq)?.dispatchId) {
        return 'done'
      }
      const dispatch = db.getDispatchContext(taskId)
      if (dispatch && !store.getAttemptBindingByDispatch(dispatch.id)) {
        return { retire: 'dispatch_outcome_unknown' }
      }
      return 'retry'
    }
  })
  effects.register('verification.enqueue', {
    execute: (effect) => {
      void verification.kick().catch(() => {
        console.warn('[axiom] Verification preparation failed', { runId: effect.payload.runId })
      })
      return 'done'
    },
    maxAttempts: 3,
    backoffMs: [1000, 5000],
    onOrphan: () => 'retry'
  })
}
