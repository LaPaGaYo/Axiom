import { z } from 'zod'
import { matchesPathPattern } from '../../../shared/axiom-contract/path-patterns'
import { AttemptFailureSchema } from '../../../shared/axiom-contract/attempt-failure'
import { redactContext } from '../context-builder/redaction'
import { AttemptPreservedAuditSchema, type PreservedSnapshot } from './preserved-snapshot-contract'
import type { LegacyAttemptBaseline, SkippedAttempt } from './attempt-baseline'

export type PreservedWorkNotUsed = {
  seq: number
  attemptId: string
  reason: 'empty' | 'out_of_scope' | 'secret' | 'unavailable'
  paths?: string[]
  detail?: string
}
export type SnapshotAttemptBaseline = {
  kind: 'snapshot'
  previousSeq: number
  attemptId: string
  snapshot: PreservedSnapshot
  scopePaths: string[]
  baselineSha: string
  artifactId?: string
  ending:
    | {
        kind: 'interrupted'
        failureClass: z.infer<typeof AttemptFailureSchema>['class']
        evidence?: 'runtime_restarted'
      }
    | { kind: 'failed'; lastError: string; reportError?: string; evidence?: 'process_exited' }
    | { kind: 'stopped'; reason: string }
  skippedAttempts: SkippedAttempt[]
  underlying: LegacyAttemptBaseline
}
const Failure = z.object({
  settlement: z.object({ kind: z.enum(['interrupted', 'failed']) }),
  failure: AttemptFailureSchema.optional(),
  lastError: z.string().optional(),
  reportError: z.string().optional()
})
const Stopped = z.object({ reason: z.string() })
const RecoveryEvidence = z.object({
  reason: z.literal('process_exited'),
  evidence: z.literal('runtime_restarted').optional(),
  exitCode: z.undefined().optional()
})

function readEnding(failure: unknown, stopped: unknown): SnapshotAttemptBaseline['ending'] | null {
  const failed = Failure.safeParse(failure)
  if (failed.success) {
    // Recovery metadata does not change which failures the existing schema accepts.
    const recovery = RecoveryEvidence.safeParse(failure)
    if (failed.data.settlement.kind === 'interrupted') {
      return {
        kind: 'interrupted',
        failureClass: failed.data.failure?.class ?? 'unknown',
        ...(recovery.success && recovery.data.evidence === 'runtime_restarted'
          ? { evidence: 'runtime_restarted' as const }
          : {})
      }
    }
    return {
      kind: 'failed',
      lastError: redactContext(failed.data.lastError ?? '').content.slice(-2000),
      ...(failed.data.reportError
        ? { reportError: redactContext(failed.data.reportError).content.slice(-2000) }
        : {}),
      ...(recovery.success && recovery.data.evidence === undefined
        ? { evidence: 'process_exited' as const }
        : {})
    }
  }
  const stop = Stopped.safeParse(stopped)
  return stop.success
    ? { kind: 'stopped', reason: redactContext(stop.data.reason).content.slice(-2000) }
    : null
}

export function readPreservedBaseline(input: {
  taskId: string
  seq: number
  attemptId: string
  audit: unknown
  failure: unknown
  stopped?: unknown
  allowedPaths: readonly string[]
}):
  | { usable: Omit<SnapshotAttemptBaseline, 'skippedAttempts' | 'underlying'> }
  | { unused: PreservedWorkNotUsed; stopWalk: boolean } {
  const identity = { seq: input.seq, attemptId: input.attemptId }
  const ending = readEnding(input.failure, input.stopped)
  const unused = (
    reason: PreservedWorkNotUsed['reason'],
    extra: Pick<PreservedWorkNotUsed, 'paths' | 'detail'> = {}
  ) => ({ unused: { ...identity, reason, ...extra }, stopWalk: ending?.kind === 'stopped' })
  const parsed = AttemptPreservedAuditSchema.safeParse(input.audit)
  if (!parsed.success || parsed.data.taskId !== input.taskId) {
    return unused('unavailable', { detail: 'invalid_preservation_audit' })
  }
  const { result, baselineSha, artifactId } = parsed.data
  if (result.status === 'empty') {
    return unused('empty')
  }
  if (result.status === 'unavailable') {
    return unused('unavailable', { detail: result.reason })
  }
  if (result.snapshot.ref !== `refs/axiom/preserved/${input.taskId}/${input.seq}`) {
    return unused('unavailable', { detail: 'invalid_preservation_audit' })
  }
  if (result.secrets.length) {
    return unused('secret')
  }
  const paths = result.scopePaths.filter(
    (path) => !input.allowedPaths.some((pattern) => matchesPathPattern(path, pattern))
  )
  if (paths.length) {
    return unused('out_of_scope', { paths })
  }
  if (!ending) {
    return unused('unavailable', { detail: 'invalid_failure_audit' })
  }
  return {
    usable: {
      kind: 'snapshot',
      previousSeq: input.seq,
      attemptId: input.attemptId,
      snapshot: result.snapshot,
      scopePaths: result.scopePaths,
      baselineSha,
      ...(artifactId ? { artifactId } : {}),
      ending
    }
  }
}
