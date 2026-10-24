import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as e2e from '../../e2e-config'
import { getAxiomControlPlane } from '../control-plane'
import { submissionFixture } from '../execution/submission-fixture.test-support'
import { releaseSubmission, type RecoveryContext } from './attempt-recovery-effects'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import { reconcileAttempt } from './attempt-reconciliation'

let f: ReturnType<typeof submissionFixture>
let ctx: RecoveryContext
let now: number
beforeEach(async () => {
  f = submissionFixture()
  expect(await f.submit()).toMatchObject({ ok: true })
  vi.clearAllTimers()
  now =
    Date.parse(exposeUtcTimestamp(f.store.getSubmissionByDispatch(f.t01.attemptId)!.createdAt)!) +
    60_000
  ctx = { ...f, artifacts: getAxiomControlPlane(f.runtime).artifacts, now: () => now }
  f.capture.mockClear()
  f.put.mockClear()
})
afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  f.db.close()
})
const binding = () => f.store.getAttemptBinding(f.t01.taskId, 1)!
function resource(state: string) {
  f.db.db
    .prepare('UPDATE worker_terminal_resources SET release_state = ? WHERE owner_dispatch_id = ?')
    .run(state, f.t01.attemptId)
}
function loseArchive() {
  f.db.db
    .prepare(
      "DELETE FROM audit_events WHERE object_id = ? AND event = 'attempt.transcript_archived'"
    )
    .run(f.t01.attemptId)
}
it.each(['not_requested', 'retained', 'requested'])(
  'releases a sixty-second-old Submission in resource state %s, archiving first after a crash',
  async (state) => {
    resource(state)
    loseArchive()
    f.releaseWorker.mockImplementationOnce(async (_runtime, dispatchId) => {
      expect(f.capture).toHaveBeenCalledOnce()
      expect(f.put).toHaveBeenCalledOnce()
      expect(f.store.listAuditEvents({ missionId: f.mission.id }).at(-1)?.event).toBe(
        'attempt.transcript_archived'
      )
      resource('released')
      return {
        dispatchId,
        state: 'released',
        processAction: 'closed_agent_terminal',
        archive: null
      }
    })
    expect(await releaseSubmission(ctx, binding())).toBe('terminal_released')
    expect(f.releaseWorker).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('SUBMITTED')
    const events = f.store.listAuditEvents({ missionId: f.mission.id })
    await releaseSubmission(ctx, binding())
    expect(f.releaseWorker).toHaveBeenCalledTimes(1)
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(events)
  }
)
it.each(['success', 'failure'])(
  'does not repeat a previously audited archive %s for the same Submission',
  async (status) => {
    if (status === 'failure') {
      loseArchive()
      f.store.appendAuditEvent({
        missionId: f.mission.id,
        actor: 'AttemptSettlement',
        objectKind: 'attempt',
        objectId: f.t01.attemptId,
        event: 'attempt.transcript_archive_failed',
        before: null,
        after: {
          submissionId: f.store.getSubmissionByDispatch(f.t01.attemptId)!.id,
          reason: 'capture_failed'
        }
      })
    }
    await releaseSubmission(ctx, binding())
    expect(f.capture).not.toHaveBeenCalled()
    expect(f.releaseWorker).toHaveBeenCalledOnce()
  }
)
it('checks Submission identity rather than treating any archive audit on the Attempt as sufficient', async () => {
  f.db.db
    .prepare(
      "UPDATE audit_events SET after = ? WHERE object_id = ? AND event = 'attempt.transcript_archived'"
    )
    .run(JSON.stringify({ submissionId: 'other' }), f.t01.attemptId)
  await releaseSubmission(ctx, binding())
  expect(f.capture).toHaveBeenCalledOnce()
})
it('audits a failed recovery archive and still requests release', async () => {
  loseArchive()
  f.capture.mockRejectedValueOnce(new Error('terminal gone'))
  await releaseSubmission(ctx, binding())
  expect(f.releaseWorker).toHaveBeenCalledOnce()
  expect(f.store.listAuditEvents({ missionId: f.mission.id }).slice(-2)).toMatchObject([
    { event: 'attempt.transcript_archive_failed', after: { reason: 'capture_failed' } },
    { event: 'attempt.terminal_released' }
  ])
})
it.each(['young', 'released', 'gone', 'releasing', 'unknown'])(
  'leaves %s submissions/resources untouched',
  async (mode) => {
    loseArchive()
    if (mode === 'young') {
      now -= 1
    } else if (mode === 'gone') {
      vi.spyOn(f.db, 'getWorkerTerminalResourceByOwner').mockReturnValue(undefined)
    } else {
      resource(mode)
    }
    const events = f.store.listAuditEvents({ missionId: f.mission.id })
    expect(await releaseSubmission(ctx, binding())).toBeUndefined()
    expect(f.capture).not.toHaveBeenCalled()
    expect(f.releaseWorker).not.toHaveBeenCalled()
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(events)
  }
)
it('honors the E2E hold during recovery and retries once it is cleared', async () => {
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: true })
  vi.stubEnv('AXIOM_E2E_HOLD_WORKER_RELEASE', '1')
  loseArchive()
  expect(await releaseSubmission(ctx, binding())).toBeUndefined()
  expect(f.capture).not.toHaveBeenCalled()
  expect(f.releaseWorker).not.toHaveBeenCalled()
  vi.stubEnv('AXIOM_E2E_HOLD_WORKER_RELEASE', '')
  await releaseSubmission(ctx, binding())
  expect(f.capture).toHaveBeenCalledOnce()
  expect(f.releaseWorker).toHaveBeenCalledOnce()
})
it('uses the Submission release path even after Mission cancellation, without stopping the Worker', async () => {
  f.missions.cancelMission(f.mission.id, 'test')
  const stop = vi.spyOn(f.db, 'beginWorkerStop')
  expect(await reconcileAttempt(ctx, binding())).toMatchObject({ action: 'terminal_released' })
  expect(f.releaseWorker).toHaveBeenCalledOnce()
  expect(stop).not.toHaveBeenCalled()
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('succeeded')
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('CANCELED')
})
