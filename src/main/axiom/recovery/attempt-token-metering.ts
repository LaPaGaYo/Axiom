import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'
import {
  currentTokenAttempt as currentAttempt,
  meterAttemptTokenUsage as meter
} from './attempt-token-measurement'

const FINALIZATIONS_PER_PASS = 20

function failed(binding: AttemptBinding) {
  console.warn('[axiom] Attempt token metering deferred', {
    missionId: binding.missionId,
    taskId: binding.taskId,
    attemptId: binding.dispatchId
  })
}

/** Only the usage ledger is written here. Meter current work before the bounded ending backlog. */
export async function meterAttemptTokens(ctx: RecoveryContext, filter?: { missionId?: string }) {
  const current: AttemptBinding[] = []
  const ended: { binding: AttemptBinding; startedAt: number }[] = []
  let missions: ReturnType<RecoveryContext['store']['listMissions']>
  try {
    missions = ctx.store.listMissions({})
  } catch {
    console.warn('[axiom] Attempt token Mission scan deferred')
    return
  }
  for (const mission of missions) {
    if (filter?.missionId && mission.id !== filter.missionId) {
      continue
    }
    let bindings: AttemptBinding[]
    try {
      bindings = ctx.store.listAttemptBindings({ missionId: mission.id })
    } catch {
      console.warn('[axiom] Attempt token binding scan deferred', { missionId: mission.id })
      continue
    }
    for (const binding of bindings) {
      try {
        if (
          !binding.dispatchId ||
          ctx.store.getAgentSpec(binding.agentSpecId)?.spec.role === 'planner' ||
          ctx.store.getAttemptTokenUsage(binding.dispatchId)?.final
        ) {
          continue
        }
        if (currentAttempt(ctx, binding)) {
          current.push(binding)
        } else {
          const dispatch = ctx.db.getWorkerDispatch(binding.dispatchId)
          const startedAt = Date.parse(
            exposeUtcTimestamp(dispatch?.created_at ?? binding.createdAt) ?? ''
          )
          ended.push({ binding, startedAt })
        }
      } catch {
        failed(binding)
      }
    }
  }
  for (const binding of current) {
    try {
      await meter(ctx, binding, true)
    } catch {
      failed(binding)
    }
  }
  ended.sort((a, b) => a.startedAt - b.startedAt || a.binding.seq - b.binding.seq)
  for (const { binding } of ended.slice(0, FINALIZATIONS_PER_PASS)) {
    try {
      await meter(ctx, binding, false)
    } catch {
      failed(binding)
    }
  }
}
