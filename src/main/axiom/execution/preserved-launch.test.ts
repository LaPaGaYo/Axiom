import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture } from '../mission-controller/controller-fixture.test-support'
import {
  attemptBaselineAudit,
  attemptBaselineRef,
  prepareWorkerFixLaunch
} from './attempt-fix-launch'
import type { AttemptBaseline } from './attempt-baseline'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => f.db.close())
const baseline: AttemptBaseline = {
  kind: 'snapshot',
  previousSeq: 1,
  attemptId: 'd1',
  snapshot: { ref: 'refs/axiom/preserved/t/1', commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40) },
  scopePaths: ['src/task.ts'],
  baselineSha: 'c'.repeat(40),
  skippedAttempts: [],
  ending: { kind: 'interrupted', failureClass: 'usage_limit' },
  underlying: { kind: 'integration', reason: 'first_attempt' }
}
it('selects the preserved commit and records a continued strategy at launch', () => {
  expect(attemptBaselineRef(baseline, 'm')).toBe('a'.repeat(40))
  expect(attemptBaselineAudit(baseline)).toEqual({
    kind: 'snapshot',
    strategy: 'continued',
    reason: 'preserved_snapshot',
    previousSeq: 1,
    attemptId: 'd1',
    commitSha: 'a'.repeat(40)
  })
})
it('records a not-continued launch strategy and its offending paths', () => {
  const fallback: AttemptBaseline = {
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [],
    notContinued: [{ seq: 1, attemptId: 'd1', reason: 'out_of_scope', paths: ['outside.ts'] }]
  }
  expect(attemptBaselineRef(fallback, 'm')).toBe('axiom/integration/m')
  expect(attemptBaselineAudit(fallback)).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    strategy: 'not_continued',
    notContinued: fallback.notContinued
  })
})
it('fails launch with fix_base_mismatch when HEAD differs from the preserved commit', async () => {
  await expect(
    prepareWorkerFixLaunch(f.db, f.store, { taskId: 't', seq: 2 }, baseline, {
      path: '/unused',
      git: {
        head: 'd'.repeat(40),
        path: '/unused',
        branch: 'axiom/attempt/t/2',
        isBare: false,
        isMainWorktree: false
      }
    })
  ).rejects.toThrow('fix_base_mismatch')
})
