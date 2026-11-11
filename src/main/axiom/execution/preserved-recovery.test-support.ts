import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import type { PreservationResult } from './preserved-snapshot-contract'

export const restartedFailure = {
  reason: 'process_exited',
  failure: { class: 'unknown', retryable: true, source: 'absent' },
  evidence: 'runtime_restarted',
  settlement: { kind: 'interrupted' }
}
export const vanishedFailure = {
  reason: 'process_exited',
  settlement: { kind: 'failed' }
}

export function seedRecoveryAttempt(
  store: AxiomStore,
  input: {
    missionId: string
    taskId: string
    seq: number
    failure?: unknown
    stopped?: unknown
    preserve?: boolean
    result?: PreservationResult
    artifactId?: string
  }
) {
  const { missionId, taskId, seq } = input
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
    actor: 'RecoveryService',
    objectKind: 'attempt' as const,
    objectId: attemptId,
    before: null
  }
  if (input.failure !== undefined) {
    store.appendAuditEvent({
      ...audit,
      event: 'attempt.failed',
      after: z.json().parse(input.failure)
    })
  }
  if (input.stopped !== undefined) {
    store.appendAuditEvent({
      ...audit,
      event: 'attempt.stopped',
      after: z.json().parse(input.stopped)
    })
  }
  if (input.preserve !== false) {
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
  }
  return { attemptId, snapshot }
}
