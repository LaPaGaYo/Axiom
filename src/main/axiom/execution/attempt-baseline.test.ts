import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture } from '../mission-controller/controller-fixture.test-support'
import { previousSubmission } from './attempt-baseline.test-support'
import { resolveAttemptBaseline } from './attempt-baseline'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => f.db.close())
const resolve = (seq = 2) => resolveAttemptBaseline(f.store, { taskId: 't', seq })

it('keeps the first Attempt on integration without consulting earlier evidence', () => {
  expect(resolve(1)).toEqual({ kind: 'integration', reason: 'first_attempt' })
})
it.each([undefined, null, 'not-submitted'])(
  'uses integration without a previous Submission (%s)',
  (dispatchId) => {
    if (dispatchId !== undefined) {
      f.store.insertAttemptBinding({
        missionId: 'm',
        taskId: 't',
        seq: 1,
        dispatchId,
        branch: 'axiom/attempt/t/1',
        agentSpecId: 'agent',
        contextPackageId: 'context'
      })
    }
    expect(resolve()).toEqual({
      kind: 'integration',
      reason: 'previous_attempt_not_submitted',
      skippedAttempts: []
    })
  }
)
it('continues the ACTIVE Candidate with its latest failed run', () => {
  const { candidate, verificationRun } = previousSubmission(f.store)
  expect(resolve()).toEqual({
    kind: 'candidate',
    previousSeq: 1,
    candidate,
    verificationRun,
    skippedAttempts: []
  })
})
it('does not continue a superseded Candidate', () => {
  previousSubmission(f.store)
  f.store.supersedeActiveCandidates('t', 'replacement')
  expect(resolve()).toEqual({ kind: 'integration', reason: 'previous_candidate_superseded' })
})
it.each(['PASS', 'INCONCLUSIVE', 'QUEUED'] as const)(
  'does not continue when the latest run is %s',
  (status) => {
    const { verificationRun } = previousSubmission(f.store)
    f.db.db
      .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
      .run('2026-10-24T00:00:00Z', verificationRun.id)
    f.store.insertVerificationRun({ ...verificationRun, id: 'latest', status })
    f.db.db
      .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
      .run('2026-10-24T00:01:00Z', 'latest')
    expect(resolve()).toEqual({ kind: 'integration', reason: 'previous_verification_not_failed' })
  }
)
it('uses integration when no verification exists', () => {
  const { verificationRun } = previousSubmission(f.store)
  f.db.db.prepare('DELETE FROM verification_runs WHERE id = ?').run(verificationRun.id)
  expect(resolve()).toEqual({ kind: 'integration', reason: 'previous_verification_not_failed' })
})
it('starts clean after secret detection but retains the failed run for safe findings', () => {
  const { verificationRun } = previousSubmission(f.store, { reason: 'secret_detected' })
  expect(resolve()).toEqual({ kind: 'integration', reason: 'secret_detected', verificationRun })
})
it('never reaches behind an unsubmitted immediately preceding Attempt', () => {
  previousSubmission(f.store)
  f.store.insertAttemptBinding({
    missionId: 'm',
    taskId: 't',
    seq: 2,
    dispatchId: null,
    branch: 'axiom/attempt/t/2',
    agentSpecId: 'agent',
    contextPackageId: 'context'
  })
  expect(resolve(3)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: []
  })
})
it('orders by createdAt, breaking same-second ties by insertion order', () => {
  const { verificationRun } = previousSubmission(f.store)
  for (const [id, status, at] of [
    ['z-new', 'PASS', '2026-10-24T00:02:00Z'],
    ['zz-old', 'PASS', '2026-10-24T00:01:00Z'],
    ['a-new', 'FAIL', '2026-10-24T00:02:00Z']
  ] as const) {
    f.store.insertVerificationRun({ ...verificationRun, id, status })
    f.db.db.prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?').run(at, id)
  }
  f.db.db
    .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
    .run('2026-10-24T00:00:00Z', verificationRun.id)
  expect(resolve()).toMatchObject({ kind: 'candidate', verificationRun: { id: 'a-new' } })
})

function unchanged(seq: number, kind = 'unchanged', reason?: string, paths?: string[]) {
  f.store.insertAttemptBinding({
    missionId: 'm',
    taskId: 't',
    seq,
    dispatchId: `d${seq}`,
    branch: `axiom/attempt/t/${seq}`,
    agentSpecId: 'agent',
    contextPackageId: 'context'
  })
  f.store.appendAuditEvent({
    missionId: 'm',
    actor: 'AttemptSettlement',
    event: 'attempt.failed',
    objectKind: 'attempt',
    objectId: `d${seq}`,
    before: null,
    after: {
      settlement: { kind, ...(reason ? { reason } : {}), ...(paths ? { paths } : {}) },
      reportSummary: `Report ${seq}`
    }
  })
}
it.each([1, 2])('walks past %s unchanged Attempts to the failed ACTIVE Candidate', (count) => {
  const { candidate, verificationRun } = previousSubmission(f.store)
  for (let seq = 2; seq <= count + 1; seq++) {
    unchanged(seq)
  }
  expect(resolve(count + 2)).toEqual({
    kind: 'candidate',
    previousSeq: 1,
    candidate,
    verificationRun,
    skippedAttempts: Array.from({ length: count }, (_, i) => ({
      kind: 'unchanged',
      seq: i + 2,
      attemptId: `d${i + 2}`,
      reportSummary: `Report ${i + 2}`
    }))
  })
})
it('does not revive a superseded Candidate behind an unchanged Attempt', () => {
  previousSubmission(f.store)
  unchanged(2)
  f.store.supersedeActiveCandidates('t', 'replacement')
  expect(resolve(3)).toEqual({ kind: 'integration', reason: 'previous_candidate_superseded' })
})
it('does not walk behind an ordinary failed Attempt', () => {
  previousSubmission(f.store)
  unchanged(2, 'failed')
  expect(resolve(3)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: []
  })
})
it('walks the baseline across an interrupted Attempt', () => {
  const { candidate, verificationRun } = previousSubmission(f.store)
  unchanged(2, 'interrupted')
  f.store.appendAuditEvent({
    missionId: 'm',
    actor: 'AttemptSettlement',
    event: 'attempt.failed',
    objectKind: 'attempt',
    objectId: 'd2',
    before: null,
    after: {
      settlement: { kind: 'interrupted' },
      failure: { class: 'usage_limit', retryable: true, source: 'structured' }
    }
  })
  expect(resolve(3)).toEqual({
    kind: 'candidate',
    previousSeq: 1,
    candidate,
    verificationRun,
    skippedAttempts: [
      {
        seq: 2,
        attemptId: 'd2',
        kind: 'interrupted',
        failureClass: 'usage_limit',
        reportSummary: null
      }
    ]
  })
})
it('reads older interrupted audits without a failure shape', () => {
  unchanged(1, 'interrupted')
  expect(resolve(2)).toMatchObject({
    kind: 'integration',
    skippedAttempts: [{ seq: 1, kind: 'interrupted', failureClass: 'unknown' }]
  })
})
it('falls back when the walk reaches seq 1 without a Submission', () => {
  unchanged(1)
  unchanged(2)
  expect(resolve(3)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [
      { seq: 1, attemptId: 'd1', kind: 'unchanged', reportSummary: 'Report 1' },
      { seq: 2, attemptId: 'd2', kind: 'unchanged', reportSummary: 'Report 2' }
    ]
  })
})
it('still starts clean for secret detection behind an unchanged Attempt', () => {
  previousSubmission(f.store, { reason: 'secret_detected' })
  unchanged(2)
  expect(resolve(3)).toMatchObject({ kind: 'integration', reason: 'secret_detected' })
})

it.each([
  ['blocked', 'blocked_by_scope', ['src/legacy.test.ts']],
  ['no_change', 'candidate_already_correct', undefined],
  ['no_change', 'cannot_reproduce', undefined]
] as const)('walks past %s (%s) while preserving its declaration', (kind, reason, paths) => {
  const { candidate } = previousSubmission(f.store)
  unchanged(2, kind, reason, paths ? [...paths] : undefined)
  expect(resolve(3)).toMatchObject({
    kind: 'candidate',
    candidate,
    skippedAttempts: [
      {
        seq: 2,
        attemptId: 'd2',
        kind,
        reason,
        ...(paths ? { paths } : {}),
        reportSummary: 'Report 2'
      }
    ]
  })
})
it('preserves a first-attempt declaration on the integration baseline', () => {
  unchanged(1, 'blocked', 'blocked_by_scope', ['src/legacy.test.ts'])
  expect(resolve(2)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [
      {
        seq: 1,
        attemptId: 'd1',
        kind: 'blocked',
        reason: 'blocked_by_scope',
        paths: ['src/legacy.test.ts'],
        reportSummary: 'Report 1'
      }
    ]
  })
})
