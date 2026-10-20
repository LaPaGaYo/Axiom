import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'
import { submissionFixture, report } from './submission-fixture.test-support'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
async function accepted(worker = f.t01) {
  const response = await f.submit(worker)
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return AttemptSubmitResponseSchema.parse(response.result)
}

describe('Attempt submission settlement', () => {
  it('writes one immutable Candidate/report, both facets, queued verification and a truthful message', async () => {
    const originalInsert = f.db.insertMessage.bind(f.db)
    vi.spyOn(f.db, 'insertMessage').mockImplementation((input) => {
      expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('completed')
      expect(f.db.db.isTransaction).toBe(true) // router transaction, after submission commit
      return originalInsert(input)
    })
    const { candidate, submission, duplicate } = await accepted()
    expect(duplicate).toBe(false)
    expect(candidate).toMatchObject({
      status: 'ACTIVE',
      commitSha: 'a'.repeat(40),
      treeSha: 'b'.repeat(40),
      attemptId: f.t01.attemptId
    })
    expect(submission).toMatchObject({
      candidateId: candidate.id,
      report,
      checksRun: report.checksRun
    })
    expect(f.store.listCandidates(f.mission.id)).toHaveLength(1)
    expect(f.store.listSubmissions(f.mission.id)).toHaveLength(1)
    expect(f.store.listVerificationRuns({ missionId: f.mission.id })).toEqual([
      expect.objectContaining({
        candidateId: candidate.id,
        taskId: f.t01.taskId,
        status: 'QUEUED',
        verifier: 'VerificationService',
        commands: [],
        toolVersions: {},
        verdictDetail: {}
      })
    ])
    expect(
      f.db.getAttemptObservationFacts(f.t01.attemptId).filter((o) => o.facet === 'artifact_git')
    ).toEqual([
      expect.objectContaining({
        payload: { artifacts: 'absent', git: 'changed' },
        authorityId: 'axiom-control-plane'
      })
    ])
    expect(
      f.db.getAttemptObservationFacts(f.t01.attemptId).filter((o) => o.facet === 'worker_report')
    ).toHaveLength(1)
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
    expect(f.db.getTask(f.t01.taskId)?.status).toBe('completed')
    expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('completed')
    expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('succeeded')
    expect(f.retain).toHaveBeenCalledExactlyOnceWith(f.t01.attemptId)
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
      expect.objectContaining({
        event: 'attempt.submitted',
        after: expect.objectContaining({
          retainDisposition: 'no_owned_resource',
          submissionId: submission.id
        })
      })
    )
    expect(f.db.getUnreadRunMailbox(f.mission.runId)).toEqual([
      expect.objectContaining({ type: 'worker_done' })
    ])
    expect(f.notify).toHaveBeenCalledWith(`run:${f.mission.runId}`, 'worker_done')
  })
  it('returns an existing immutable Submission for an authenticated duplicate', async () => {
    const first = await accepted()
    const before = f.store.listCandidates(f.mission.id)
    expect(await accepted()).toEqual({ ...first, duplicate: true })
    expect(f.store.listCandidates(f.mission.id)).toEqual(before)
    expect(f.store.listSubmissions(f.mission.id)).toHaveLength(1)
    expect(f.snapshotGit).toHaveBeenCalledTimes(1)
    expect(f.retain).toHaveBeenCalledTimes(1)
    expect(f.db.getUnreadRunMailbox(f.mission.runId)).toHaveLength(1)
  })
  it('supersedes the previous ACTIVE Candidate when a later Attempt submits', async () => {
    const first = await accepted()
    f.db.updateTaskStatus(f.t01.taskId, 'ready')
    const secondWorker = f.bind('T01')
    f.snapshotGit.mockResolvedValueOnce({
      commitSha: 'c'.repeat(40),
      treeSha: 'd'.repeat(40),
      snapshotCommitted: false
    })
    const second = await accepted(secondWorker)
    expect(f.store.getCandidate(first.candidate.id)).toMatchObject({
      status: 'SUPERSEDED',
      supersededBy: second.candidate.id
    })
    expect(f.store.listCandidates(f.mission.id).filter((c) => c.status === 'ACTIVE')).toEqual([
      second.candidate
    ])
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
      expect.objectContaining({ event: 'candidate.superseded', objectId: first.candidate.id })
    )
  })
  it('rejects a later Attempt adopting an existing commit without superseding it', async () => {
    await accepted()
    f.db.updateTaskStatus(f.t01.taskId, 'ready')
    const worker = f.bind('T01')
    const before = f.snapshot()
    expect(await f.submit(worker)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', message: 'candidate_exists' }
    })
    expect(f.snapshot()).toEqual(before)
  })
  it('rejected settlement writes nothing', async () => {
    let before: ReturnType<typeof f.snapshot>
    f.snapshotGit.mockImplementationOnce(async () => {
      // An independent settlement wins while Git is awaited; use the real kernel rejection.
      f.db.settleWorkerReport({
        taskId: f.t01.taskId,
        dispatchId: f.t01.attemptId,
        outcome: 'failed',
        result: 'lost race'
      })
      before = f.snapshot()
      return { commitSha: 'a'.repeat(40), treeSha: 'b'.repeat(40), snapshotCommitted: false }
    })
    expect(await f.submit()).toMatchObject({ ok: false, error: { code: 'inactive_dispatch' } })
    expect(f.snapshot()).toEqual(before!)
    expect(f.retain).not.toHaveBeenCalled()
    expect(f.store.listCandidates(f.mission.id)).toEqual([])
    expect(f.store.listSubmissions(f.mission.id)).toEqual([])
    expect(f.notify).not.toHaveBeenCalled()
  })
  it('rolls back settlement when retention fails, including its capability revocation', async () => {
    f.retain.mockImplementationOnce(() => {
      throw new Error('retain failed')
    })
    const before = f.snapshot()
    expect(await f.submit()).toMatchObject({ ok: false })
    expect(f.snapshot()).toEqual(before)
    expect(f.notify).not.toHaveBeenCalled()
  })
  it('guards RUNNING → SUBMITTED against every actor except AttemptSettlement', () => {
    const before = f.snapshot()
    expect(() =>
      f.missions.transitionTaskStage({
        taskId: f.t01.taskId,
        to: 'SUBMITTED',
        actor: 'Worker',
        reason: 'done'
      })
    ).toThrow('illegal_transition')
    expect(f.snapshot()).toEqual(before)
  })
})
