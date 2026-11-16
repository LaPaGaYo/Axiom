import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AttemptSubmitResponseSchema } from '../../../shared/axiom-contract/attempt-params'
import type { Candidate } from '../../../shared/axiom-contract/submission-params'
import { sha256 } from '../artifacts/artifact-store'
import { submissionFixture } from './submission-fixture.test-support'

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

it('pins the candidate before the submission is committed and not again on a replay', async () => {
  const commitSha = 'a'.repeat(40)
  const candidateId = `cand_${sha256(`${f.t01.taskId}:${commitSha}`)}`
  const observations: { transaction: boolean; candidate: Candidate | undefined }[] = []
  f.pin.mockImplementation(async (_worktree, id) => {
    observations.push({ transaction: f.db.db.isTransaction, candidate: f.store.getCandidate(id) })
    return { pinned: true, ref: `refs/axiom/candidates/${id}` }
  })
  const response = await f.submit()
  expect(f.pin).toHaveBeenCalledTimes(1)
  expect(f.pin).toHaveBeenCalledWith(
    f.db.getWorkerDispatch(f.t01.attemptId)?.worktree_id,
    candidateId,
    commitSha
  )
  expect(observations).toEqual([{ transaction: false, candidate: undefined }])
  expect(response).toMatchObject({
    ok: true,
    result: { duplicate: false, candidate: { id: candidateId } }
  })
  expect(f.store.getCandidate(candidateId)?.id).toBe(candidateId)
  expect(await f.submit()).toMatchObject({ ok: true, result: { duplicate: true } })
  expect(f.pin).toHaveBeenCalledTimes(1)
})

it('records a failed pin in the audit and still accepts the submission', async () => {
  const candidateId = `cand_${sha256(`${f.t01.taskId}:${'a'.repeat(40)}`)}`
  const ref = `refs/axiom/candidates/${candidateId}`
  f.pin.mockResolvedValueOnce({ pinned: false, ref, reason: 'ref_conflict' })
  const response = await f.submit()
  const events = f.store.listAuditEvents({ missionId: f.mission.id })
  const failed = events.filter((e) => e.event === 'candidate.pin_failed')
  expect(failed).toHaveLength(1)
  expect(failed[0]).toMatchObject({
    missionId: f.mission.id,
    actor: 'AttemptSettlement',
    objectKind: 'candidate',
    objectId: candidateId,
    event: 'candidate.pin_failed',
    before: null,
    after: { ref, reason: 'ref_conflict' }
  })
  expect(events.findIndex((e) => e.event === 'candidate.pin_failed')).toBeLessThan(
    events.findIndex((e) => e.event === 'attempt.submitted')
  )
  expect(response).toMatchObject({ ok: true })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  expect(AttemptSubmitResponseSchema.parse(response.result)).toMatchObject({
    duplicate: false,
    candidate: { id: candidateId },
    submission: { candidateId }
  })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
  expect(f.store.listVerificationRuns({ missionId: f.mission.id })).toMatchObject([
    { candidateId, status: 'QUEUED' }
  ])
})

it('leaves the audits of a submission unchanged when the pin succeeds', async () => {
  expect(await f.submit()).toMatchObject({ ok: true })
  const events = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(events.filter((e) => e.event === 'candidate.pin_failed')).toHaveLength(0)
  expect(events.filter((e) => e.event === 'attempt.submitted')).toHaveLength(1)
  expect(events.filter((e) => e.event === 'candidate.superseded')).toHaveLength(0)
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
})
