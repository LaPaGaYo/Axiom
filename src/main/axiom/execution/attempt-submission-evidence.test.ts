import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture, report } from './submission-fixture.test-support'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'
import { getAxiomControlPlane } from '../control-plane'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  f.db.close()
  vi.restoreAllMocks()
})
function artifact(missionId: string, related: string[]) {
  return f.store.insertArtifact({
    id: 'art-report',
    missionId,
    related,
    kind: 'worker_report',
    sha256: 'c'.repeat(64),
    sizeBytes: 10,
    mediaType: 'text/markdown',
    createdBy: 'worker'
  })
}
it.each(['task', 'attempt'] as const)(
  'accepts same-Mission report Artifacts related to the %s',
  async (target) => {
    const saved = artifact(f.mission.id, [target === 'task' ? f.t01.taskId : f.t01.attemptId])
    f.snapshotGit.mockResolvedValueOnce({
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      snapshotCommitted: false
    })
    expect(
      await f.call('axiom.attempt.submit', {
        ...f.params(),
        report: { ...report, artifacts: [saved.id] }
      })
    ).toMatchObject({ ok: true })
    expect(f.db.getAttemptObservationFacts(f.t01.attemptId)).toContainEqual(
      expect.objectContaining({
        facet: 'artifact_git',
        payload: { artifacts: 'present', git: 'clean' }
      })
    )
    expect(f.store.listMessages({ missionId: f.mission.id })[0]?.artifactIds).toEqual([saved.id])
  }
)
it.each(['mission', 'relation'] as const)(
  'rejects a report Artifact with the wrong %s before Git',
  async (reason) => {
    artifact(
      reason === 'mission' ? 'other' : f.mission.id,
      reason === 'relation' ? ['unrelated'] : [f.t01.taskId]
    )
    const before = f.snapshot()
    expect(
      await f.call('axiom.attempt.submit', {
        ...f.params(),
        report: { ...report, artifacts: ['art-report'] }
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
    expect(f.snapshot()).toEqual(before)
    expect(f.snapshotGit).not.toHaveBeenCalled()
  }
)
it('records archive storage failure without changing the settled result or suppressing release', async () => {
  f.put.mockRejectedValueOnce(new Error('sensitive storage failure'))
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.transcript_archive_failed',
      after: {
        submissionId: f.store.getSubmissionByDispatch(f.t01.attemptId)!.id,
        reason: 'store_failed'
      }
    })
  )
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
  expect(f.store.listCandidates(f.mission.id)).toHaveLength(1)
  expect(f.store.listVerificationRuns({ missionId: f.mission.id })[0]?.status).toBe('QUEUED')
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).toHaveBeenCalledOnce()
})
it('serializes concurrent submissions and snapshots only once', async () => {
  const results = await Promise.all([f.submit(), f.submit()])
  const parsed = results.map((result) => {
    expect(result).toMatchObject({ ok: true })
    if (!result.ok) {
      throw new Error(result.error.code)
    }
    return AttemptSubmitResponseSchema.parse(result.result)
  })
  expect(parsed.map((r) => r.duplicate)).toEqual([false, true])
  expect(parsed[0]!.submission).toEqual(parsed[1]!.submission)
  expect(f.snapshotGit).toHaveBeenCalledTimes(1)
  expect(f.store.listVerificationRuns({ missionId: f.mission.id })).toHaveLength(1)
})
it('fences a new admission during the async snapshot', async () => {
  let before: ReturnType<typeof f.snapshot>
  f.snapshotGit.mockImplementationOnce(async () => {
    f.store.insertAttemptBinding({
      ...f.store.getAttemptBinding(f.t01.taskId, 1)!,
      seq: 2,
      branch: `axiom/attempt/${f.t01.taskId}/2`,
      dispatchId: null
    })
    before = f.snapshot()
    return { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), snapshotCommitted: false }
  })
  expect(await f.submit()).toMatchObject({ ok: false, error: { code: 'stale_dispatch' } })
  expect(f.snapshot()).toEqual(before!)
})
it('rejects kernel duplicate settlement without an Axiom Submission', async () => {
  f.snapshotGit.mockImplementationOnce(async () => {
    f.db.settleWorkerReport({
      taskId: f.t01.taskId,
      dispatchId: f.t01.attemptId,
      outcome: 'succeeded',
      result: 'outside Axiom'
    })
    return { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), snapshotCommitted: false }
  })
  expect(await f.submit()).toMatchObject({ ok: false, error: { code: 'inactive_dispatch' } })
  expect(f.store.listCandidates(f.mission.id)).toEqual([])
  expect(f.store.listSubmissions(f.mission.id)).toEqual([])
})
it.each([
  'unknown_task',
  'unknown_dispatch',
  'task_dispatch_mismatch',
  'inactive_dispatch',
  'stale_dispatch'
] as const)('rolls back and preserves kernel rejection %s', async (code) => {
  vi.spyOn(f.db, 'settleWorkerReportInTransaction').mockReturnValueOnce({
    action: 'rejected',
    code,
    reason: 'rejected'
  })
  const before = f.snapshot()
  expect(await f.submit()).toMatchObject({ ok: false, error: { code } })
  expect(f.snapshot()).toEqual(before)
})
it('recovers a missing post-commit message through authenticated duplicate submission', async () => {
  vi.spyOn(f.db, 'insertMessage').mockImplementationOnce(() => {
    throw new Error('message write failed')
  })
  expect(
    await f.call('axiom.attempt.submit', {
      ...f.params(),
      report: { ...report, summary: 'x'.repeat(4000) }
    })
  ).toMatchObject({ ok: false })
  const stored = f.store.getSubmissionByDispatch(f.t01.attemptId)
  expect(stored?.report.summary).toBe('x'.repeat(4000))
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).not.toHaveBeenCalled()
  expect(await f.submit()).toMatchObject({
    ok: true,
    result: { duplicate: true, submission: stored }
  })
  expect(f.store.listMessages({ missionId: f.mission.id })).toEqual([
    expect.objectContaining({
      summary: `${'x'.repeat(1999)}…`,
      related: { submissionId: stored?.id }
    })
  ])
  expect(f.snapshotGit).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).not.toHaveBeenCalled()
})
it('schedules only after commit and suppresses the stage trigger on rollback', async () => {
  const schedule = vi
    .spyOn(getAxiomControlPlane(f.runtime).scheduler, 'scheduleRound')
    .mockResolvedValue({ admitted: [], skipped: [] })
  vi.spyOn(getAxiomControlPlane(f.runtime).store, 'insertVerificationRun').mockImplementationOnce(
    () => {
      throw new Error('verification queue unavailable')
    }
  )
  expect(await f.submit()).toMatchObject({ ok: false })
  await Promise.resolve()
  expect(schedule).not.toHaveBeenCalled()
  expect(await f.submit()).toMatchObject({ ok: true })
  await Promise.resolve()
  expect(schedule).toHaveBeenCalledWith(f.mission.id, 'stage_change')
})
