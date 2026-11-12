import {
  auditAttempt,
  lastAttemptAudit,
  type AttemptBinding,
  type RecoveryContext
} from './attempt-recovery-effects'

type Cadence = {
  binding: AttemptBinding
  startedAt: number
  firstSampleAt: number
  lastSampleAt: number
  samples: number
  maxEventGapMs: number
  lastPass: RecoveryContext
}

// Measurements are deliberately lost with the runtime; they are not execution authority.
const cadences = new WeakMap<RecoveryContext['runtime'], Map<string, Cadence>>()

export function sampleAttemptCadence(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  startedAt: number,
  sampledAt: number,
  idleMs: number
) {
  if (!binding.dispatchId) {
    return
  }
  let entries = cadences.get(ctx.runtime)
  if (!entries) {
    entries = new Map()
    cadences.set(ctx.runtime, entries)
  }
  const previous = entries.get(binding.dispatchId)
  if (previous) {
    // Authority re-reads may recurse within the same reconcile pass.
    if (previous.lastPass !== ctx) {
      previous.lastSampleAt = sampledAt
      previous.samples++
      previous.maxEventGapMs = Math.max(previous.maxEventGapMs, idleMs)
      previous.lastPass = ctx
    }
  } else {
    entries.set(binding.dispatchId, {
      binding,
      startedAt,
      firstSampleAt: sampledAt,
      lastSampleAt: sampledAt,
      samples: 1,
      maxEventGapMs: idleMs,
      lastPass: ctx
    })
  }
}

export function flushAttemptCadences(ctx: RecoveryContext, resolutionMs: number) {
  const entries = cadences.get(ctx.runtime)
  if (!entries) {
    return
  }
  for (const [attemptId, cadence] of entries) {
    const { binding } = cadence
    try {
      const current = ctx.store.getAttemptBinding(binding.taskId, binding.seq)
      if (
        current?.dispatchId === attemptId &&
        ctx.store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
        ctx.store.nextAttemptSeq(binding.taskId) === binding.seq + 1 &&
        !ctx.store.getSubmissionByDispatch(attemptId)
      ) {
        continue
      }
      if (!lastAttemptAudit(ctx, binding, 'attempt.cadence')) {
        auditAttempt(ctx, binding, 'attempt.cadence', {
          maxEventGapMs: cadence.maxEventGapMs,
          samples: cadence.samples,
          resolutionMs,
          partial: cadence.firstSampleAt - cadence.startedAt > 2 * resolutionMs
        })
      }
      entries.delete(attemptId)
    } catch {
      // Keep the completed measurement intact for the next pass; never log file contents.
      console.warn('[axiom] Attempt cadence audit deferred', { attemptId })
    }
  }
}
