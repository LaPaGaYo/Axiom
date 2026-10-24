import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture } from './submission-fixture.test-support'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  f.db.close()
})
function previous(treeSha = 'b'.repeat(40)) {
  return f.store.insertCandidate({
    id: 'previous',
    missionId: f.mission.id,
    taskId: f.t01.taskId,
    attemptId: 'earlier-attempt',
    commitSha: 'c'.repeat(40),
    treeSha,
    status: 'ACTIVE',
    supersededBy: null
  })
}
it('rejects candidate_unchanged inside settlement without any rows or Attempt changes', async () => {
  previous()
  const before = f.snapshot()
  expect(await f.submit()).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument', message: 'candidate_unchanged' }
  })
  expect(f.snapshot()).toEqual(before)
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('dispatched')
  expect(f.kick).not.toHaveBeenCalled()
  expect(f.capture).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).not.toHaveBeenCalled()
  f.snapshotGit.mockResolvedValueOnce({
    commitSha: 'd'.repeat(40),
    treeSha: 'e'.repeat(40),
    snapshotCommitted: true
  })
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(f.store.getCandidate('previous')?.status).toBe('SUPERSEDED')
})
it('accepts a changed tree', async () => {
  previous('f'.repeat(40))
  expect(await f.submit()).toMatchObject({ ok: true })
})
it('accepts the first Candidate of a Task', async () => {
  expect(await f.submit()).toMatchObject({ ok: true })
})
