import type { AxiomStore } from '../db/axiom-store'
import type { PreservationResult } from './preserved-snapshot-contract'

export function seedPreservedAttempt(
  store: AxiomStore,
  input: {
    missionId: string
    taskId: string
    seq: number
    kind?: 'interrupted' | 'failed'
    result?: PreservationResult
    artifactId?: string
  }
) {
  const { missionId, taskId, seq, kind = 'interrupted' } = input
  const attemptId = `d${seq}`
  const snapshot = {
    ref: `refs/axiom/preserved/${taskId}/${seq}`,
    commitSha: String(seq).repeat(40),
    treeSha: 'a'.repeat(40)
  }
  store.insertAttemptBinding({
    missionId,
    taskId,
    seq,
    dispatchId: attemptId,
    branch: `axiom/attempt/${taskId}/${seq}`,
    agentSpecId: 'agent',
    contextPackageId: 'context'
  })
  const audit = {
    missionId,
    actor: 'AttemptSettlement',
    objectKind: 'attempt' as const,
    objectId: attemptId,
    before: null
  }
  store.appendAuditEvent({
    ...audit,
    event: 'attempt.failed',
    after: {
      settlement: { kind },
      failure: { class: 'usage_limit', retryable: true, source: 'text' },
      lastError: kind === 'failed' ? 'Parser failed at line 8' : 'Usage limit reached',
      reportError: 'Missing report'
    }
  })
  store.appendAuditEvent({
    ...audit,
    event: 'attempt.preserved',
    after: {
      taskId,
      baselineSha: 'b'.repeat(40),
      result: input.result ?? {
        status: 'preserved',
        snapshot,
        scopePaths: ['src/task.ts'],
        secrets: []
      },
      ...(input.artifactId ? { artifactId: input.artifactId } : {})
    }
  })
  return { attemptId, snapshot }
}
