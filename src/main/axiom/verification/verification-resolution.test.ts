import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanReviewFixture } from './human-review-fixture.test-support'
import { resolveVerification } from './verification-resolution'
import { getAxiomControlPlane } from '../control-plane'

let f: ReturnType<typeof humanReviewFixture>
beforeEach(() => {
  f = humanReviewFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const rationale = 'The example must mention leap days.'
const resolve = (verdict: 'PASS' | 'FAIL', extra = {}, requestId?: string) =>
  f.call(
    'axiom.verification.resolve',
    { runId: f.run.id, verdict, rationale, ...extra },
    requestId ? { orchestrationRequestId: requestId } : {}
  )

it('rolls back the verdict, stages and audit if recording the receipt fails', () => {
  const before = f.snapshot()
  expect(() =>
    resolveVerification(
      getAxiomControlPlane(f.runtime),
      { runId: f.run.id, verdict: 'FAIL', rationale, criteria: [1] },
      () => {
        throw new Error('Receipt unavailable')
      }
    )
  ).toThrow('Receipt unavailable')
  expect(f.snapshot()).toEqual(before)
})

it('resolves PASS atomically, attributes the human and replays the receipt', async () => {
  const result = await resolve('PASS', {}, 'resolve-pass')
  expect(result).toMatchObject({ ok: true, result: { runId: f.run.id, status: 'PASS' } })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFIED')
  expect(f.store.getVerificationRun(f.run.id)?.verdictDetail).toMatchObject({
    verdict: 'INCONCLUSIVE',
    reason: 'acceptance_human',
    resolution: { verdict: 'PASS', rationale, criteria: [], by: 'user', at: expect.any(String) }
  })
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'verification.resolved',
        objectId: f.run.id,
        after: {
          verdict: 'PASS',
          rationale,
          criteria: [],
          taskId: f.task.taskId,
          candidateId: f.candidate.id,
          by: 'user'
        }
      }),
      expect.objectContaining({
        event: 'task.stage',
        actor: 'user',
        after: expect.objectContaining({ stage: 'VERIFIED', reason: 'verification_resolved' })
      })
    ])
  )
  const before = f.snapshot()
  expect(await resolve('PASS', {}, 'resolve-pass')).toMatchObject({
    ok: true,
    result: { runId: f.run.id, status: 'PASS' }
  })
  expect(f.snapshot()).toEqual(before)
})

it.each([1, 2])(
  'settles human FAIL through the retry rules after %s Attempts',
  async (attemptCount) => {
    f.db.db
      .prepare('UPDATE task_stages SET attempt_count = ? WHERE task_id = ?')
      .run(attemptCount, f.task.taskId)
    expect(await resolve('FAIL', { criteria: [1] })).toMatchObject({
      ok: true,
      result: { status: 'FAIL' }
    })
    expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.resolution).toEqual({
      verdict: 'FAIL',
      rationale,
      criteria: [1],
      disposition: 'fixed',
      by: 'user',
      at: expect.any(String)
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(
      attemptCount === 1 ? 'READY' : 'BLOCKED'
    )
    expect(
      f.store
        .listAuditEvents({ missionId: f.missionId })
        .filter((e) => e.event === 'task.stage')
        .slice(-2)
    ).toMatchObject([
      { actor: 'user', before: { stage: 'VERIFYING' }, after: { stage: 'NEEDS_FIX' } },
      {
        actor: 'user',
        after: {
          stage: attemptCount === 1 ? 'READY' : 'BLOCKED',
          reason: attemptCount === 1 ? 'retry' : 'retry_budget_exhausted'
        }
      }
    ])
  }
)

it.each(['PASS', 'FAIL', 'INCONCLUSIVE', 'QUEUED'] as const)(
  'refuses %s without writes',
  async (status) => {
    f.db.db.prepare('UPDATE verification_runs SET status = ? WHERE id = ?').run(status, f.run.id)
    const before = f.snapshot()
    expect(await resolve('PASS')).toMatchObject({
      ok: false,
      error: {
        code: 'illegal_transition',
        data: {
          runId: f.run.id,
          from: status,
          to: 'PASS',
          reason:
            status === 'PASS' || status === 'FAIL'
              ? 'deterministic_verdict_final'
              : 'run_not_pending'
        }
      }
    })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each([{ rationale: `ghp_${'a'.repeat(30)}` }, { criteria: [2] }])(
  'rejects invalid human input before any write: %j',
  async (extra) => {
    const before = f.snapshot()
    const result = await resolve('FAIL', extra)
    expect(result).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    if ('rationale' in extra) {
      expect(result).toMatchObject({ error: { message: 'secret_in_rationale' } })
    }
    expect(f.snapshot()).toEqual(before)
  }
)

it.each(['candidate', 'task', 'mission'] as const)('rejects stale %s ownership', async (kind) => {
  if (kind === 'candidate') {
    f.store.supersedeActiveCandidates(f.task.taskId, 'other')
  }
  if (kind === 'task') {
    f.controller.cancelTask({ taskId: f.task.taskId, actor: 'user', rationale: 'Cancel' })
  }
  if (kind === 'mission') {
    f.db.db
      .prepare('UPDATE verification_runs SET mission_id = ? WHERE id = ?')
      .run('wrong', f.run.id)
  }
  const before = f.snapshot()
  expect(await resolve('PASS')).toMatchObject({ ok: false, error: { code: 'stale_state' } })
  expect(f.snapshot()).toEqual(before)
})

it('rejects a missing run and non-desktop callers', async () => {
  expect(await resolve('PASS', { runId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'not_found' }
  })
  expect(
    await f.dispatcher.dispatch(
      {
        id: 'local',
        authToken: 'test',
        method: 'axiom.verification.resolve',
        params: { runId: f.run.id, verdict: 'PASS', rationale },
        orchestrationContractVersion: 1,
        orchestrationRequestId: 'local'
      },
      { caller: { kind: 'local-cli' } }
    )
  ).toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
})
