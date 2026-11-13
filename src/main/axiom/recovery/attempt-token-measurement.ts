import {
  TokenUsageReadingSchema,
  emptyTokenUsage
} from '../../../shared/axiom-contract/token-usage'
import { isHeadlessAttempt } from '../execution/attempt-exit-submission'
import { headlessLaunchProvider } from '../execution/headless-launch-record'
import { readCodexAttemptUsage } from '../execution/codex-attempt-usage'
import { readClaudeAttemptUsage } from '../execution/claude-attempt-usage'
import { readAttemptSession } from '../execution/in-place-session'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'

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

export function currentTokenAttempt(ctx: RecoveryContext, binding: AttemptBinding): boolean {
  return (
    ctx.store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
    ctx.store.nextAttemptSeq(binding.taskId) === binding.seq + 1 &&
    !!binding.dispatchId &&
    ctx.store.getAttemptBinding(binding.taskId, binding.seq)?.dispatchId === binding.dispatchId &&
    !ctx.store.getSubmissionByDispatch(binding.dispatchId)
  )
}

/** False means the read lost its current/window fence and must not drive supervision. */
export async function meterAttemptTokenUsage(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  current: boolean
): Promise<boolean> {
  const { dispatchId } = binding
  if (!dispatchId) {
    return false
  }
  const previous = ctx.store.getAttemptTokenUsage(dispatchId)
  if (previous?.final) {
    return currentTokenAttempt(ctx, binding) === current
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
    currentTokenAttempt(ctx, binding) !== current ||
    (provider === 'codex' && successorWindow(ctx, binding) !== window)
  ) {
    return false
  }
  if (
    current &&
    ((!previous && reading.newTokens === 0) ||
      (previous &&
        JSON.stringify(TokenUsageReadingSchema.parse(previous)) ===
          JSON.stringify(TokenUsageReadingSchema.parse(reading))))
  ) {
    return true
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
  return true
}
