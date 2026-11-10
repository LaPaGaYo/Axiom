import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { resolveAttemptBaseline } from './attempt-baseline'
import { previousSubmission } from './attempt-baseline.test-support'
import { seedPreservedAttempt } from './preserved-baseline.test-support'
import type { PreservationResult } from './preserved-snapshot-contract'

let f: ReturnType<typeof planned>
let taskId: string
beforeEach(() => {
  f = planned(fixture())
  taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  allow(['src/task.ts'])
})
afterEach(() => f.db.close())
function allow(paths: string[]) {
  const task = f.store.getTaskStage(taskId)
  if (!task) {
    throw new Error('missing task')
  }
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, scope: { allowedPaths: paths } },
    retryPolicy: task.retryPolicy
  })
}
function seed(
  seq: number,
  kind: 'interrupted' | 'failed' = 'interrupted',
  result?: PreservationResult
) {
  return seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq, kind, result })
}
const resolve = (seq = 2) => resolveAttemptBaseline(f.store, { taskId, seq })
const candidate = () => previousSubmission(f.store, { missionId: f.missionId, taskId })

it('continues the next Attempt from the preserved snapshot', () => {
  const { snapshot } = seed(1)
  expect(resolve()).toEqual({
    kind: 'snapshot',
    previousSeq: 1,
    attemptId: 'd1',
    snapshot,
    scopePaths: ['src/task.ts'],
    baselineSha: 'b'.repeat(40),
    ending: { kind: 'interrupted', failureClass: 'usage_limit' },
    skippedAttempts: [],
    underlying: { kind: 'integration', reason: 'first_attempt' }
  })
})
it('does not continue a preserved snapshot that leaves the allowed paths', () => {
  seed(1, 'failed')
  allow(['elsewhere/**'])
  expect(resolve()).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [],
    notContinued: [{ seq: 1, attemptId: 'd1', reason: 'out_of_scope', paths: ['src/task.ts'] }]
  })
})
it('does not continue a preserved snapshot that contains a secret', () => {
  seed(1, 'interrupted', {
    status: 'preserved',
    snapshot: {
      ref: `refs/axiom/preserved/${taskId}/1`,
      commitSha: '1'.repeat(40),
      treeSha: 'a'.repeat(40)
    },
    scopePaths: ['src/task.ts'],
    secrets: [{ path: 'src/task.ts', pattern: 'provider_token' }]
  })
  expect(resolve()).toMatchObject({ kind: 'integration', notContinued: [{ reason: 'secret' }] })
  allow(['**'])
  expect(resolve()).toMatchObject({ kind: 'integration', notContinued: [{ reason: 'secret' }] })
})
it('keeps the failed Candidate evidence when a preserved fix Attempt is continued', () => {
  const { candidate: failed, verificationRun } = candidate()
  seed(2)
  expect(resolve(3)).toMatchObject({
    kind: 'snapshot',
    underlying: { kind: 'candidate', candidate: failed, verificationRun }
  })
})
it('keeps a failed Candidate below a chain of two continued snapshots', () => {
  const { candidate: failed, verificationRun } = candidate()
  seed(2)
  seed(3, 'failed')
  expect(resolve(4)).toMatchObject({
    kind: 'snapshot',
    previousSeq: 3,
    ending: { kind: 'failed', lastError: 'Parser failed at line 8', reportError: 'Missing report' },
    underlying: { kind: 'candidate', candidate: failed, verificationRun }
  })
})
it('reconsiders an older snapshot against paths a human allowed later', () => {
  seed(1)
  seed(2, 'interrupted', { status: 'empty' })
  allow(['other.ts'])
  expect(resolve(3).kind).toBe('integration')
  allow(['src/**'])
  expect(resolve(3)).toMatchObject({
    kind: 'snapshot',
    previousSeq: 1,
    notContinued: [{ seq: 2, reason: 'empty' }],
    skippedAttempts: [{ seq: 2 }]
  })
})
it.each(['empty', 'unavailable'] as const)(
  'walks an interrupted predecessor with %s work to an older usable snapshot',
  (status) => {
    seed(1)
    seed(2, 'interrupted', status === 'empty' ? { status } : { status, reason: 'git_timeout' })
    expect(resolve(3)).toMatchObject({
      kind: 'snapshot',
      previousSeq: 1,
      notContinued: [
        { seq: 2, reason: status, ...(status === 'unavailable' ? { detail: 'git_timeout' } : {}) }
      ]
    })
  }
)
it('stops at a failed predecessor with no usable work', () => {
  seed(1)
  seed(2, 'failed', { status: 'empty' })
  expect(resolve(3)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [],
    notContinued: [{ seq: 2, attemptId: 'd2', reason: 'empty' }]
  })
})
it('rejects a mismatched preservation audit without changing legacy walk rules', () => {
  seed(1, 'interrupted', {
    status: 'preserved',
    snapshot: {
      ref: 'refs/axiom/preserved/another/1',
      commitSha: '1'.repeat(40),
      treeSha: 'a'.repeat(40)
    },
    scopePaths: ['src/task.ts'],
    secrets: []
  })
  expect(resolve()).toMatchObject({
    kind: 'integration',
    notContinued: [{ reason: 'unavailable', detail: 'invalid_preservation_audit' }]
  })
})
