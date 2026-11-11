import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import * as snapshots from '../execution/preserved-snapshot'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'

let f: Awaited<ReturnType<typeof recoveryPreservationFixture>>
beforeEach(async () => {
  f = await recoveryPreservationFixture()
})
afterEach(async () => {
  await f.cleanup()
})

async function noCapture() {
  expect(snapshots.preserveAttemptWorktree).not.toHaveBeenCalled()
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(await f.repo.git(['for-each-ref', '--format=%(refname)', f.ref])).toBe('')
}
it.each(['kernel', 'exit', 'budget'] as const)(
  'settles a TUI %s ending without capture',
  async (kind) => {
    vi.spyOn(snapshots, 'preserveAttemptWorktree')
    f.db.db
      .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
      .run('{}', f.t01.attemptId)
    if (kind === 'kernel') {
      await stopLocalWorker(f.runtime, f.t01.attemptId)
    }
    if (kind === 'exit') {
      f.observe('exited')
    }
    await f.recovery.reconcileAttempts()
    expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
    if (kind === 'kernel') {
      expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toMatchObject([
        { after: { reason: 'kernel_stopped' } }
      ])
    }
    if (kind === 'exit') {
      expect(f.audits().find((row) => row.event === 'attempt.failed')?.after).not.toHaveProperty(
        'settlement'
      )
    }
    await noCapture()
  }
)
it.each(['failed', 'abandoned'] as const)(
  'does not preserve a headless kernel %s ending',
  async (state) => {
    vi.spyOn(snapshots, 'preserveAttemptWorktree')
    if (state === 'failed') {
      f.db.failDispatch(f.t01.attemptId, 'kernel failure', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
    } else {
      f.db.abandonWorkerDispatch(f.t01.attemptId, f.runtime.getRuntimeId(), 'fixture')
    }
    await f.recovery.reconcileAttempts()
    expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
    await noCapture()
  }
)
it.each(['unverifiable', 'stop_unknown'] as const)(
  'does not preserve after %s reaches its tolerance',
  async (kind) => {
    vi.spyOn(snapshots, 'preserveAttemptWorktree')
    if (kind === 'stop_unknown') {
      vi.mocked(f.runtime.closeTerminal).mockResolvedValue({
        handle: f.t01.from,
        tabId: 'tab',
        ptyKilled: false
      })
      await f.recovery.reconcileAttempts()
      // Even a later observed exit cannot turn an unconfirmed stop into a capture.
      f.observe('exited')
    } else {
      f.observe('unverifiable')
    }
    await f.recovery.reconcileAttempts()
    f.advance(31 * 60_000)
    await f.recovery.reconcileAttempts()
    expect(f.db.getWorkerDispatch(f.t01.attemptId)?.state).toBe('abandoned')
    expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
    await noCapture()
  }
)
it('continues settlement when the capture routine rejects', async () => {
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockRejectedValue(new Error('storage unavailable'))
  expect(await f.recovery.reconcileAttempts()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('READY')
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
})
