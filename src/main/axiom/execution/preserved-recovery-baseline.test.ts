import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { resolveAttemptBaseline } from './attempt-baseline'
import { previousSubmission } from './attempt-baseline.test-support'
import { seedPreservedAttempt } from './preserved-baseline.test-support'
import {
  restartedFailure,
  vanishedFailure,
  seedRecoveryAttempt
} from './preserved-recovery.test-support'
import type { PreservationResult } from './preserved-snapshot-contract'

let f: ReturnType<typeof planned>
let taskId: string
beforeEach(() => {
  f = planned(fixture())
  taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  const task = f.store.getTaskStage(taskId)
  if (!task) {
    throw new Error('Missing Task')
  }
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, scope: { allowedPaths: ['src/**'] } },
    retryPolicy: task.retryPolicy
  })
})
afterEach(() => f.db.close())

const resolve = (seq = 2) => resolveAttemptBaseline(f.store, { taskId, seq })
const seed = (input: Omit<Parameters<typeof seedRecoveryAttempt>[1], 'taskId' | 'missionId'>) =>
  seedRecoveryAttempt(f.store, { ...input, missionId: f.missionId, taskId })

it('continues the next Attempt from the snapshot of a stopped Attempt', () => {
  const { attemptId, snapshot } = seed({
    seq: 1,
    stopped: { reason: 'runtime_budget_exceeded' }
  })
  expect(resolve()).toEqual({
    kind: 'snapshot',
    previousSeq: 1,
    attemptId,
    snapshot,
    scopePaths: ['src/task.ts'],
    baselineSha: 'b'.repeat(40),
    ending: { kind: 'stopped', reason: 'runtime_budget_exceeded' },
    skippedAttempts: [],
    underlying: { kind: 'integration', reason: 'first_attempt' }
  })
})

it.each(['interrupted', 'failed'] as const)(
  'prefers a valid %s failure over the stopped audit',
  (kind) => {
    seed({
      seq: 1,
      failure: {
        settlement: { kind },
        failure: { class: 'usage_limit', retryable: true, source: 'text' },
        lastError: 'Parser failed',
        reportError: 'Report missing',
        evidence: { ignoredByExistingSchema: true }
      },
      stopped: { reason: 'kernel_stopped' }
    })
    expect(resolve()).toMatchObject({
      kind: 'snapshot',
      ending:
        kind === 'interrupted'
          ? { kind, failureClass: 'usage_limit' }
          : { kind, lastError: 'Parser failed', reportError: 'Report missing' }
    })
  }
)

it('uses the stopped reason when the failure audit does not parse', () => {
  seed({ seq: 1, failure: { reason: 'kernel_failed' }, stopped: { reason: 'kernel_stopped' } })
  expect(resolve()).toMatchObject({
    kind: 'snapshot',
    ending: { kind: 'stopped', reason: 'kernel_stopped' }
  })
})

it.each([{}, { reason: 42 }])('rejects a stopped audit without a string reason: %j', (stopped) => {
  seed({ seq: 1, stopped })
  expect(resolve()).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [],
    notContinued: [
      { seq: 1, attemptId: 'd1', reason: 'unavailable', detail: 'invalid_failure_audit' }
    ]
  })
})

it.each(['empty', 'out_of_scope', 'secret', 'unavailable'] as const)(
  'stops the baseline walk at a stopped Attempt whose snapshot is %s',
  (reason) => {
    seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 1 })
    const result: PreservationResult =
      reason === 'empty'
        ? { status: 'empty' }
        : reason === 'unavailable'
          ? { status: 'unavailable', reason: 'git_timeout' }
          : {
              status: 'preserved',
              snapshot: {
                ref: `refs/axiom/preserved/${taskId}/2`,
                commitSha: '2'.repeat(40),
                treeSha: 'a'.repeat(40)
              },
              scopePaths: [reason === 'out_of_scope' ? 'outside.ts' : 'src/task.ts'],
              secrets: reason === 'secret' ? [{ path: 'src/task.ts', pattern: 'token' }] : []
            }
    seed({
      seq: 2,
      // A declaration is not a parsed interrupted/failed ending and cannot hide the later stop.
      failure: { settlement: { kind: 'unchanged' } },
      stopped: { reason: 'runtime_budget_exceeded' },
      result
    })
    expect(resolve(3)).toEqual({
      kind: 'integration',
      reason: 'previous_attempt_not_submitted',
      skippedAttempts: [],
      notContinued: [
        {
          seq: 2,
          attemptId: 'd2',
          reason,
          ...(reason === 'out_of_scope' ? { paths: ['outside.ts'] } : {}),
          ...(reason === 'unavailable' ? { detail: 'git_timeout' } : {})
        }
      ]
    })
  }
)

it.each(['stopped', 'failed', 'interrupted', 'unchanged'] as const)(
  'preserves the legacy %s baseline when no preservation audit exists',
  (kind) => {
    const { candidate, verificationRun } = previousSubmission(f.store, {
      missionId: f.missionId,
      taskId
    })
    seed({
      seq: 2,
      preserve: false,
      stopped: { reason: 'kernel_stopped' },
      ...(kind === 'stopped' ? {} : { failure: { settlement: { kind } } })
    })
    const skippedAttempts = [
      {
        kind,
        seq: 2,
        attemptId: 'd2',
        reportSummary: null,
        ...(kind === 'interrupted' ? { failureClass: 'unknown' } : {})
      }
    ]
    expect(resolve(3)).toEqual(
      kind === 'stopped' || kind === 'failed'
        ? { kind: 'integration', reason: 'previous_attempt_not_submitted', skippedAttempts: [] }
        : { kind: 'candidate', previousSeq: 1, candidate, verificationRun, skippedAttempts }
    )
  }
)

it('carries only the continued Attempt recovery evidence', () => {
  seed({ seq: 1, failure: restartedFailure })
  seed({ seq: 2, failure: vanishedFailure })
  expect(resolve(2)).toMatchObject({
    kind: 'snapshot',
    ending: { kind: 'interrupted', failureClass: 'unknown', evidence: 'runtime_restarted' }
  })
  expect(resolve(3)).toMatchObject({
    kind: 'snapshot',
    ending: { kind: 'failed', lastError: '', evidence: 'process_exited' }
  })
})

it.each(['interrupted', 'failed'] as const)('keeps the exit-code %s ending unchanged', (kind) => {
  seed({
    seq: 1,
    failure: {
      reason: 'process_exited',
      evidence: 'exit_code',
      exitCode: 1,
      settlement: { kind },
      failure: { class: 'transport_error', retryable: true, source: 'text' },
      lastError: 'Socket closed'
    }
  })
  const baseline = resolve()
  if (baseline.kind !== 'snapshot') {
    throw new Error('Expected snapshot baseline')
  }
  expect(baseline.ending).toEqual(
    kind === 'interrupted'
      ? { kind, failureClass: 'transport_error' }
      : { kind, lastError: 'Socket closed' }
  )
})
