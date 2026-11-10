import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  interruptionFixture,
  interruptionNow
} from '../execution/interruption-fixture.test-support'
import { stopHeadlessAttemptWatchers } from '../execution/headless-attempt-watcher'
import { RecoveryService } from './recovery-service'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'

let f: ReturnType<typeof interruptionFixture>
beforeEach(() => {
  f = interruptionFixture()
  f.setExit(undefined)
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    terminal: null,
    exact: true,
    status: 'exited',
    terminalHandle: f.t01.from
  })
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  await f.plane.effects.stop()
  vi.clearAllTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
it('settles a headless Attempt lost to a runtime restart as interrupted', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
    .run('old', f.t01.attemptId)
  vi.spyOn(f.runtime, 'getTerminalLivenessVerdict').mockReturnValue({ status: 'exited' })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: f.plane.artifacts,
    now: () => interruptionNow
  })
  expect(await recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.effect(1)).toMatchObject({
    status: 'pending',
    payload: { failureClass: 'unknown', chain: 1 }
  })
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      actor: 'RecoveryService',
      event: 'attempt.failed',
      after: {
        taskId: f.t01.taskId,
        seq: 1,
        reason: 'process_exited',
        evidence: 'runtime_restarted',
        settlement: { kind: 'interrupted' },
        failure: { class: 'unknown', retryable: true, source: 'absent' }
      }
    })
  )
  await recovery.reconcileAttempts()
  expect(f.store.getTaskStage(f.t01.taskId)?.attemptCount).toBe(0)
})
it('keeps the same-epoch headless process exit on the ordinary failure path', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
    .run(f.runtime.getRuntimeId(), f.t01.attemptId)
  vi.spyOn(f.runtime, 'getTerminalLivenessVerdict').mockReturnValue({ status: 'exited' })
  const recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: f.plane.artifacts
  })
  expect(await recovery.reconcileAttempts()).toMatchObject({ attempts: [{ action: 'failed' }] })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(f.effect(1)).toBeUndefined()
})
