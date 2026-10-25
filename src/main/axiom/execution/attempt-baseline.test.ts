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
    expect(resolve()).toEqual({ kind: 'integration', reason: 'previous_attempt_not_submitted' })
  }
)
it('continues the ACTIVE Candidate with its latest failed run', () => {
  const { candidate, verificationRun } = previousSubmission(f.store)
  expect(resolve()).toEqual({ kind: 'candidate', previousSeq: 1, candidate, verificationRun })
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
  expect(resolve(3)).toEqual({ kind: 'integration', reason: 'previous_attempt_not_submitted' })
})
it('orders by createdAt then id, independently of insertion order', () => {
  const { verificationRun } = previousSubmission(f.store)
  for (const [id, status, at] of [
    ['z-new', 'FAIL', '2026-10-24T00:02:00Z'],
    ['zz-old', 'PASS', '2026-10-24T00:01:00Z'],
    ['a-new', 'PASS', '2026-10-24T00:02:00Z']
  ] as const) {
    f.store.insertVerificationRun({ ...verificationRun, id, status })
    f.db.db.prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?').run(at, id)
  }
  f.db.db
    .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
    .run('2026-10-24T00:00:00Z', verificationRun.id)
  expect(resolve()).toMatchObject({ kind: 'candidate', verificationRun: { id: 'z-new' } })
})
