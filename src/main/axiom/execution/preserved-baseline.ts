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
    | { kind: 'interrupted'; failureClass: z.infer<typeof AttemptFailureSchema>['class'] }
    | { kind: 'failed'; lastError: string; reportError?: string }
  skippedAttempts: SkippedAttempt[]
  underlying: LegacyAttemptBaseline
}
const Failure = z.object({
  settlement: z.object({ kind: z.enum(['interrupted', 'failed']) }),
  failure: AttemptFailureSchema.optional(),
  lastError: z.string().optional(),
  reportError: z.string().optional()
})

export function readPreservedBaseline(input: {
  taskId: string
  seq: number
  attemptId: string
  audit: unknown
  failure: unknown
  allowedPaths: readonly string[]
}):
  | { usable: Omit<SnapshotAttemptBaseline, 'skippedAttempts' | 'underlying'> }
  | { unused: PreservedWorkNotUsed } {
  const identity = { seq: input.seq, attemptId: input.attemptId }
  const unused = (
    reason: PreservedWorkNotUsed['reason'],
    extra: Pick<PreservedWorkNotUsed, 'paths' | 'detail'> = {}
  ) => ({ unused: { ...identity, reason, ...extra } })
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
  const failed = Failure.safeParse(input.failure)
  if (!failed.success) {
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
      ending:
        failed.data.settlement.kind === 'interrupted'
          ? { kind: 'interrupted', failureClass: failed.data.failure?.class ?? 'unknown' }
          : {
              kind: 'failed',
              lastError: redactContext(failed.data.lastError ?? '').content.slice(-2000),
              ...(failed.data.reportError
                ? { reportError: redactContext(failed.data.reportError).content.slice(-2000) }
                : {})
            }
    }
  }
}
