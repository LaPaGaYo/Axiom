import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { humanReviewFixture } from './human-review-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { rerunVerification } from './verification-rerun'

let f: ReturnType<typeof humanReviewFixture>
beforeEach(() => {
  f = humanReviewFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const rationale = 'The criteria now match the requirement.'
const rerun = (extra = {}, requestId?: string) =>
  f.call(
    'axiom.verification.rerun',
    { taskId: f.task.taskId, rationale, ...extra },
    requestId ? { orchestrationRequestId: requestId } : {}
  )
const runs = () => f.store.listVerificationRuns({ missionId: f.missionId, taskId: f.task.taskId })

it('rolls back cancellation, queue insertion and audit if recording the receipt fails', () => {
  const before = f.snapshot()
  expect(() =>
    rerunVerification(getAxiomControlPlane(f.runtime), { taskId: f.task.taskId, rationale }, () => {
      throw new Error('Receipt unavailable')
    })
  ).toThrow('Receipt unavailable')
  expect(f.snapshot()).toEqual(before)
})

it('cancels the human review and queues a claimable run for the same Candidate, with a durable receipt', async () => {
  const plane = getAxiomControlPlane(f.runtime)
  vi.spyOn(plane.verification, 'kick').mockResolvedValue(undefined)
  expect(await rerun({}, 'rerun-once')).toMatchObject({
    ok: true,
    result: { runId: expect.any(String), status: 'QUEUED' }
  })
  expect(runs()).toHaveLength(2)
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'CANCELED',
    verdictDetail: {
      verdict: 'INCONCLUSIVE',
      rerun: { rationale, by: 'user', at: expect.any(String) }
    }
  })
  const queued = runs().find((run) => run.status === 'QUEUED')
  expect(queued).toMatchObject({ candidateId: f.candidate.id, claimCount: 0 })
  expect(f.store.listEffects({ missionId: f.missionId })).toEqual([
    expect.objectContaining({
      kind: 'verification.enqueue',
      key: queued?.id,
      payload: { runId: queued?.id }
    })
  ])
  expect(runs().at(-1)?.id).toBe(queued?.id)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
  expect(f.store.listAuditEvents({ missionId: f.missionId }).at(-1)).toMatchObject({
    event: 'verification.rerun_requested',
    after: {
      taskId: f.task.taskId,
      candidateId: f.candidate.id,
      previousRunId: f.run.id,
      newRunId: queued?.id,
      rationale
    }
  })
  const before = f.snapshot()
  expect(await rerun({}, 'rerun-once')).toMatchObject({
    ok: true,
    result: { runId: queued?.id, status: 'QUEUED' }
  })
  expect(f.snapshot()).toEqual(before)
  expect(plane.verification.claimNext()).toMatchObject({
    id: queued?.id,
    status: 'RUNNING',
    claimCount: 1
  })
  expect(f.store.getTaskStage(f.task.taskId)?.attemptCount).toBe(1)
  expect(await rerun()).toMatchObject({
    ok: false,
    error: { code: 'illegal_transition', data: { reason: 'task_not_rerunnable' } }
  })
})

it.each(['PASS', 'FAIL'] as const)(
  'reruns a BLOCKED Task without editing its final %s run',
  async (status) => {
    vi.spyOn(getAxiomControlPlane(f.runtime).verification, 'kick').mockResolvedValue(undefined)
    f.store.updateVerificationRun({ id: f.run.id, expectedStatus: 'HUMAN_REVIEW', status })
    f.controller.transitionTaskStage({
      taskId: f.task.taskId,
      to: 'NEEDS_FIX',
      actor: 'test',
      reason: 'failed'
    })
    f.controller.transitionTaskStage({
      taskId: f.task.taskId,
      to: 'BLOCKED',
      actor: 'test',
      reason: 'candidate_disputed'
    })
    const old = f.store.getVerificationRun(f.run.id)
    expect(await rerun()).toMatchObject({ ok: true, result: { status: 'QUEUED' } })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
    expect(f.store.getVerificationRun(f.run.id)).toEqual(old)
    expect(runs().find((r) => r.status === 'QUEUED')?.candidateId).toBe(f.candidate.id)
  }
)

it.each(['READY', 'RUNNING', 'VERIFIED', 'CANCELED'] as const)(
  'refuses %s without writes',
  async (stage) => {
    f.db.db.prepare('UPDATE task_stages SET stage = ? WHERE task_id = ?').run(stage, f.task.taskId)
    const before = f.snapshot()
    expect(await rerun()).toMatchObject({
      ok: false,
      error: {
        code: 'illegal_transition',
        data: { taskId: f.task.taskId, from: stage, reason: 'task_not_rerunnable' }
      }
    })
    expect(f.snapshot()).toEqual(before)
  }
)
it.each(['QUEUED', 'RUNNING'] as const)('refuses concurrent %s verification', async (status) => {
  f.db.db.prepare('UPDATE verification_runs SET status = ? WHERE id = ?').run(status, f.run.id)
  const before = f.snapshot()
  expect(await rerun()).toMatchObject({ ok: false, error: { code: 'illegal_transition' } })
  expect(f.snapshot()).toEqual(before)
})
it('requires an ACTIVE candidate and rejects secrets without writes', async () => {
  const before = f.snapshot()
  expect(await rerun({ rationale: `ghp_${'a'.repeat(30)}` })).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument', message: 'secret_in_rationale' }
  })
  expect(f.snapshot()).toEqual(before)
  f.store.supersedeActiveCandidates(f.task.taskId, 'other')
  const stale = f.snapshot()
  expect(await rerun()).toMatchObject({
    ok: false,
    error: { code: 'illegal_transition', data: { reason: 'task_not_rerunnable' } }
  })
  expect(f.snapshot()).toEqual(stale)
})
