import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as e2e from '../../e2e-config'
import { submissionFixture } from './submission-fixture.test-support'
import {
  releaseSubmittedWorker,
  scheduleSubmittedWorkerRelease,
  WORKER_RELEASE_GRACE_MS
} from './attempt-worker-release'

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  f.db.close()
})
const submission = () => ({
  missionId: f.mission.id,
  taskId: f.t01.taskId,
  attemptId: f.t01.attemptId,
  id: 'submission'
})
it('unrefs its two second timer and audits only the kernel receipt fields', async () => {
  const timer = vi.spyOn(globalThis, 'setTimeout')
  f.releaseWorker.mockResolvedValueOnce({
    dispatchId: f.t01.attemptId,
    state: 'retained',
    processAction: 'none',
    archive: null,
    reason: 'identity_unproven',
    lastError: 'sensitive'
  })
  scheduleSubmittedWorkerRelease(f.runtime, submission())
  expect(WORKER_RELEASE_GRACE_MS).toBe(2000)
  expect(timer.mock.results[0].value.hasRef()).toBe(false)
  await vi.advanceTimersByTimeAsync(1999)
  expect(f.releaseWorker).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)).toMatchObject({
    event: 'attempt.terminal_released',
    objectKind: 'attempt',
    objectId: f.t01.attemptId,
    after: { submissionId: 'submission', state: 'retained', processAction: 'none', archive: null }
  })
  expect(JSON.stringify(f.store.listAuditEvents({ missionId: f.mission.id }))).not.toContain(
    'sensitive'
  )
})
it('audits a fixed release failure without changing Submission or Task authority', async () => {
  expect(await f.submit()).toMatchObject({ ok: true })
  const before = f.store.getSubmissionByDispatch(f.t01.attemptId)
  f.releaseWorker.mockRejectedValueOnce(new Error('sensitive kernel output'))
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)).toMatchObject({
    event: 'attempt.terminal_release_failed',
    after: { submissionId: before!.id, reason: 'release_failed' }
  })
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toEqual(before)
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
})
it.each([true, false])('honors the hold variable only with E2E enabled=%s', async (enabled) => {
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled })
  vi.stubEnv('AXIOM_E2E_HOLD_WORKER_RELEASE', '1')
  const timer = vi.spyOn(globalThis, 'setTimeout')
  expect(await f.submit()).toMatchObject({ ok: true })
  expect(f.capture).toHaveBeenCalledOnce()
  expect(timer.mock.calls.filter(([, delay]) => delay === 2000)).toHaveLength(enabled ? 0 : 1)
  await vi.advanceTimersByTimeAsync(2000)
  expect(f.releaseWorker).toHaveBeenCalledTimes(enabled ? 0 : 1)
  await releaseSubmittedWorker(f.runtime, submission())
  expect(f.releaseWorker).toHaveBeenCalledTimes(enabled ? 0 : 2)
})
