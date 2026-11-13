import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanReviewFixture } from './human-review-fixture.test-support'

let f: ReturnType<typeof humanReviewFixture>
beforeEach(() => {
  f = humanReviewFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

const rationale = 'Reviewed the recorded evidence.'
function setReason(reason: string | undefined) {
  const { reason: _reason, ...detail } = f.run.verdictDetail
  f.db.db
    .prepare('UPDATE verification_runs SET verdict_detail = ? WHERE id = ?')
    .run(JSON.stringify({ ...detail, ...(reason === undefined ? {} : { reason }) }), f.run.id)
}
const resolve = (verdict: 'PASS' | 'FAIL', disposition?: string, requestId?: string) =>
  f.call(
    'axiom.verification.resolve',
    { runId: f.run.id, verdict, rationale, criteria: [1], ...(disposition ? { disposition } : {}) },
    requestId ? { orchestrationRequestId: requestId } : {}
  )
const audits = () =>
  f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((event) => event.event === 'verification.resolved')

it.each([undefined, 'fixed'])('records fixed when a person fails a run', async (disposition) => {
  expect(await resolve('FAIL', disposition)).toMatchObject({
    ok: true,
    result: { runId: f.run.id, status: 'FAIL' }
  })
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'FAIL',
    verdictDetail: {
      ...f.run.verdictDetail,
      resolution: {
        verdict: 'FAIL',
        rationale,
        criteria: [1],
        disposition: 'fixed',
        by: 'user',
        at: expect.any(String)
      }
    }
  })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('READY')
  expect(audits()).toMatchObject([{ after: { verdict: 'FAIL', disposition: 'fixed' } }])
})

it.each(['rejected', 'intentional', 'not_worth'])(
  'refuses a failing resolution that names another disposition',
  async (disposition) => {
    const before = f.snapshot()
    expect(await resolve('FAIL', disposition)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'disposition_mismatch' }
    })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each([
  'test_tampering',
  'dangerous_change',
  'diff_too_large',
  'environment',
  'plan_invalid',
  'policy_invalid',
  'flaky',
  'known_flaky',
  undefined,
  'future_reason'
])('requires a disposition to pass a run the checks flagged', async (reason) => {
  setReason(reason)
  const before = f.snapshot()
  for (const disposition of [undefined, 'fixed']) {
    expect(await resolve('PASS', disposition)).toMatchObject({
      ok: false,
      error: {
        code: 'invalid_argument',
        message: disposition === undefined ? 'disposition_required' : 'disposition_mismatch'
      }
    })
    expect(f.snapshot()).toEqual(before)
  }
})

it.each(['rejected', 'intentional', 'not_worth'])(
  'records the disposition a person gave when passing a flagged run',
  async (disposition) => {
    setReason('test_tampering')
    expect(await resolve('PASS', disposition)).toMatchObject({
      ok: true,
      result: { runId: f.run.id, status: 'PASS' }
    })
    const resolution = {
      verdict: 'PASS',
      rationale,
      criteria: [1],
      disposition,
      by: 'user',
      at: expect.any(String)
    }
    expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
      status: 'PASS',
      verdictDetail: { ...f.run.verdictDetail, reason: 'test_tampering', resolution }
    })
    expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.resolution).toEqual(resolution)
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFIED')
    expect(audits()).toEqual([
      expect.objectContaining({
        actor: 'VerificationService',
        objectKind: 'verification_run',
        objectId: f.run.id,
        after: {
          verdict: 'PASS',
          rationale,
          criteria: [1],
          disposition,
          taskId: f.task.taskId,
          candidateId: f.candidate.id,
          by: 'user'
        }
      })
    ])
  }
)

it.each(['acceptance_human', 'non_code'])(
  'refuses a disposition when the plan asked for the review',
  async (reason) => {
    setReason(reason)
    const before = f.snapshot()
    for (const disposition of ['fixed', 'rejected', 'intentional', 'not_worth']) {
      expect(await resolve('PASS', disposition)).toMatchObject({
        ok: false,
        error: { code: 'invalid_argument', message: 'disposition_not_applicable' }
      })
      expect(f.snapshot()).toEqual(before)
    }
  }
)

it.each(['acceptance_human', 'non_code'])(
  'stores no disposition when a person confirms a review the plan asked for',
  async (reason) => {
    setReason(reason)
    expect(await resolve('PASS')).toMatchObject({ ok: true, result: { status: 'PASS' } })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFIED')
    expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.resolution).toEqual({
      verdict: 'PASS',
      rationale,
      criteria: [1],
      by: 'user',
      at: expect.any(String)
    })
    expect(audits()).toHaveLength(1)
    expect(audits()[0].after).toEqual({
      verdict: 'PASS',
      rationale,
      criteria: [1],
      taskId: f.task.taskId,
      candidateId: f.candidate.id,
      by: 'user'
    })
  }
)

it('replays a resolution with its disposition from the receipt', async () => {
  setReason('test_tampering')
  const result = await resolve('PASS', 'intentional', 'disposition-replay')
  expect(result).toMatchObject({ ok: true, result: { runId: f.run.id, status: 'PASS' } })
  const before = f.snapshot()
  expect(await resolve('PASS', 'intentional', 'disposition-replay')).toMatchObject({
    ok: true,
    result: { runId: f.run.id, status: 'PASS' }
  })
  expect(f.snapshot()).toEqual(before)
  expect(audits()).toHaveLength(1)
  expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.resolution).toMatchObject({
    disposition: 'intentional'
  })
})
