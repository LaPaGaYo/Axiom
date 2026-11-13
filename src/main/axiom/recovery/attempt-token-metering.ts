import {
  TokenUsageReadingSchema,
  emptyTokenUsage
} from '../../../shared/axiom-contract/token-usage'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { isHeadlessAttempt } from '../execution/attempt-exit-submission'
import { headlessLaunchProvider } from '../execution/headless-launch-record'
import { readCodexAttemptUsage } from '../execution/codex-attempt-usage'
import { readClaudeAttemptUsage } from '../execution/claude-attempt-usage'
import { readAttemptSession } from '../execution/in-place-session'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'

const FINALIZATIONS_PER_PASS = 20

function successorWindow(ctx: RecoveryContext, binding: AttemptBinding): string {
  const next = ctx.store
    .listAttemptBindings({ missionId: binding.missionId, taskId: binding.taskId })
    .find((item) => item.seq > binding.seq)
  if (!next) {
    return ''
  }
  return JSON.stringify([
    next.seq,
    next.dispatchId,
    next.dispatchId
      ? readAttemptSession(ctx.store, binding.missionId, next.dispatchId)?.id
      : undefined,
    next.dispatchId ? ctx.db.getWorkerDispatch(next.dispatchId)?.created_at : undefined
  ])
}

function currentAttempt(ctx: RecoveryContext, binding: AttemptBinding): boolean {
  return (
    ctx.store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
    ctx.store.nextAttemptSeq(binding.taskId) === binding.seq + 1 &&
    !!binding.dispatchId &&
    !ctx.store.getSubmissionByDispatch(binding.dispatchId)
  )
}

async function meter(ctx: RecoveryContext, binding: AttemptBinding, current: boolean) {
  const { dispatchId } = binding
  if (!dispatchId) {
    return
  }
  const previous = ctx.store.getAttemptTokenUsage(dispatchId)
  if (previous?.final) {
    return
  }
  const worker = ctx.db.getWorkerDispatch(dispatchId)
  const provider = headlessLaunchProvider(ctx.store, binding, worker)
  const window = provider === 'codex' ? successorWindow(ctx, binding) : ''
  const reading = !isHeadlessAttempt(worker)
    ? emptyTokenUsage('unavailable')
    : provider === 'codex'
      ? await readCodexAttemptUsage(ctx, binding, current)
      : provider === 'claude'
        ? await readClaudeAttemptUsage(dispatchId)
        : emptyTokenUsage('unavailable')
  // File IO can overlap submission or a new binding. Let the next pass use the settled window.
  if (
    currentAttempt(ctx, binding) !== current ||
    (provider === 'codex' && successorWindow(ctx, binding) !== window)
  ) {
    return
  }
  if (
    current &&
    ((!previous && reading.newTokens === 0) ||
      (previous &&
        JSON.stringify(TokenUsageReadingSchema.parse(previous)) ===
          JSON.stringify(TokenUsageReadingSchema.parse(reading))))
  ) {
    return
  }
  ctx.store.upsertAttemptTokenUsage({
    ...reading,
    attemptId: dispatchId,
    missionId: binding.missionId,
    taskId: binding.taskId,
    seq: binding.seq,
    provider,
    final: !current,
    measuredAt: new Date(ctx.now()).toISOString()
  })
}

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
