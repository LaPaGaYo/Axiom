import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verificationFixture, verificationRuntime } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { settleVerificationVerdict } from './verification-settlement'
import type { VerificationVerdict } from './verification-verdict'

let f: ReturnType<typeof verificationFixture>
beforeEach(() => {
  f = verificationFixture('/unused')
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it.each([
  'environment',
  'flaky',
  'known_flaky',
  'non_code',
  'policy_invalid',
  'plan_invalid',
  'acceptance_human',
  'dangerous_change',
  'diff_too_large',
  'test_tampering'
] as const)('routes %s to HUMAN_REVIEW and preserves the verdict', (reason) => {
  settle({ verdict: 'INCONCLUSIVE', reason, escalation: 'human' })
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'HUMAN_REVIEW',
    verdictDetail: { verdict: 'INCONCLUSIVE', reason, acceptance: [] }
  })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
  expect(f.store.listAuditEvents({ missionId: f.missionId }).slice(-2)).toMatchObject([
    { event: 'verification.inconclusive' },
    {
      event: 'verification.escalated',
      after: { to: 'HUMAN_REVIEW', reason, escalation: 'human', routing: 'human' }
    }
  ])
})
it('records specialist_unavailable when policy asks for a Reviewer', () => {
  settle({ verdict: 'INCONCLUSIVE', reason: 'flaky', escalation: 'specialist' })
  expect(f.store.getVerificationRun(f.run.id)?.status).toBe('HUMAN_REVIEW')
  expect(f.store.listAuditEvents({ missionId: f.missionId }).at(-1)?.after).toEqual({
    to: 'HUMAN_REVIEW',
    reason: 'flaky',
    escalation: 'specialist',
    routing: 'specialist_unavailable'
  })
})
it.each(['PASS', 'FAIL'] as const)('keeps deterministic %s final', (verdict) => {
  settle({ verdict, reason: verdict === 'PASS' ? 'checks_passed' : 'checks_failed' })
  expect(f.store.getVerificationRun(f.run.id)?.status).toBe(verdict)
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .some((e) => e.event === 'verification.escalated')
  ).toBe(false)
})
function settle(verdict: VerificationVerdict) {
  const deps = {
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime: verificationRuntime(),
    runtimeEpoch: 'epoch'
  }
  const run = new VerificationService(deps).claimNext()
  if (!run) {
    throw new Error('Expected claim')
  }
  return settleVerificationVerdict(deps, {
    run,
    verdict,
    verdictDetail: { ...verdict, acceptance: [] },
    result: { checks: [], toolVersions: {} },
    commands: [],
    finishedAt: 'now'
  })
}
