import { z } from 'zod'
import { StallReconciliationSchema } from '../../../shared/axiom-contract/supervision'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import {
  auditAttempt,
  lastAttemptAudit,
  type AttemptBinding,
  type RecoveryContext
} from './attempt-recovery-effects'
import { proposeStallUpgrade } from '../supervision/supervision-proposals'
import { STALL_RECONCILIATION_LIMIT } from './stall-proposal-policy'

const Observation = z.object({
  taskId: AxiomIdSchema,
  seq: z.number().int().positive(),
  rule: z.literal('stalled'),
  mode: z.enum(['observe', 'notify']),
  wouldActAt: z.iso.datetime()
})
type Outcome = Pick<z.infer<typeof StallReconciliationSchema>, 'outcome' | 'endedBy' | 'endedAt'>
const terminalRuns = new Set(['PASS', 'FAIL', 'CANCELED'])
const Ending = z.object({
  reason: z.string().optional(),
  settlement: z.object({ kind: z.string() }).optional()
})

function iso(timestamp: string): string {
  return z.iso.datetime().parse(exposeUtcTimestamp(timestamp))
}

function attemptOutcome(ctx: RecoveryContext, binding: AttemptBinding): Outcome | undefined {
  const submission = binding.dispatchId
    ? ctx.store.getSubmissionByDispatch(binding.dispatchId)
    : undefined
  if (submission) {
    const runs = ctx.store.listVerificationRuns({
      missionId: binding.missionId,
      candidateId: submission.candidateId
    })
    const endedAt = iso(submission.createdAt)
    if (runs.some((run) => run.status === 'PASS')) {
      return { outcome: 'false_positive', endedBy: 'verification_pass', endedAt }
    }
    if (runs.some((run) => !terminalRuns.has(run.status))) {
      return
    }
    if (runs.some((run) => run.status === 'FAIL')) {
      return { outcome: 'hit', endedBy: 'verification_fail', endedAt }
    }
    return { outcome: 'inconclusive', endedBy: runs.length ? 'canceled_runs' : 'unknown', endedAt }
  }
  if (
    ctx.store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
    ctx.store.nextAttemptSeq(binding.taskId) === binding.seq + 1
  ) {
    return
  }
  const stopped = lastAttemptAudit(ctx, binding, 'attempt.stopped')
  if (stopped) {
    const timeout = Ending.parse(JSON.parse(stopped.after ?? '{}')).reason === 'timeout'
    return {
      outcome: timeout ? 'hit' : 'inconclusive',
      endedBy: timeout ? 'timeout' : 'stopped',
      endedAt: iso(stopped.created_at)
    }
  }
  const failed = lastAttemptAudit(ctx, binding, 'attempt.failed')
  if (failed) {
    const kind = Ending.parse(JSON.parse(failed.after ?? '{}')).settlement?.kind
    const endedAt = iso(failed.created_at)
    if (kind === 'failed' || kind === 'unchanged') {
      return { outcome: 'hit', endedBy: kind, endedAt }
    }
    return {
      outcome: 'inconclusive',
      endedAt,
      endedBy:
        kind === 'interrupted'
          ? 'interrupted'
          : kind === 'no_change' || kind === 'blocked'
            ? 'declared'
            : 'unknown'
    }
  }
  const abandoned = lastAttemptAudit(ctx, binding, 'attempt.abandoned')
  if (abandoned) {
    return { outcome: 'inconclusive', endedBy: 'abandoned', endedAt: iso(abandoned.created_at) }
  }
  const unknownStop = lastAttemptAudit(ctx, binding, 'attempt.stop_unknown')
  // No ending fact is known: record when this pass established that the binding is no longer current.
  return {
    outcome: 'inconclusive',
    endedBy: 'unknown',
    endedAt: unknownStop ? iso(unknownStop.created_at) : new Date(ctx.now()).toISOString()
  }
}

function reconcileObservation(ctx: RecoveryContext, sequence: number): void {
  ctx.store.transaction('stall_reconciliation', () => {
    // Re-read inside the transaction: overlapping callers cannot append twice for the same observation.
    const audit = ctx.store.getUnreconciledStallObservation(sequence)
    if (!audit) {
      return
    }
    const observation = Observation.parse(audit.after)
    const binding = ctx.store.getAttemptBinding(observation.taskId, observation.seq)
    if (
      !binding ||
      binding.missionId !== audit.missionId ||
      binding.dispatchId !== audit.objectId
    ) {
      throw new Error('Stall observation binding is unavailable or mismatched')
    }
    const outcome = attemptOutcome(ctx, binding)
    if (!outcome) {
      return
    }
    const result = StallReconciliationSchema.parse({
      rule: 'stalled',
      mode: observation.mode,
      observationSequence: sequence,
      ...outcome,
      ...(outcome.outcome === 'hit'
        ? { savedMs: Math.max(0, Date.parse(outcome.endedAt) - Date.parse(observation.wouldActAt)) }
        : {})
    })
    auditAttempt(ctx, binding, 'attempt.supervision_reconciled', result)
  })
}

export function reconcileStallObservations(ctx: RecoveryContext): void {
  let sequences: number[]
  try {
    sequences = ctx.store.listUnreconciledStallObservations(STALL_RECONCILIATION_LIMIT)
  } catch {
    console.warn('[axiom] Stall observation scan failed')
    return
  }
  for (const sequence of sequences) {
    try {
      reconcileObservation(ctx, sequence)
    } catch {
      console.warn('[axiom] Stall observation reconciliation failed', {
        observationSequence: sequence
      })
    }
  }
  try {
    proposeStallUpgrade(ctx.store)
  } catch {
    console.warn('[axiom] Stall upgrade proposal evaluation failed')
  }
}
