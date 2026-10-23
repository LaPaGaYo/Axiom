import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { plannerFixture } from '../execution/planner-fixture.test-support'
import { createPlannerLauncher } from '../execution/planner-launcher'
import { RecoveryService } from './recovery-service'
import * as observation from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import * as release from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'

let f: Awaited<ReturnType<typeof plannerFixture>>
let attemptId: string
let recovery: RecoveryService
let now: number
beforeEach(async () => {
  f = await plannerFixture()
  attemptId = (await createPlannerLauncher(f.deps).start(f.mission.id)).attempt.attemptId!
  now = Date.now()
  recovery = new RecoveryService(f.db, f.store, f.missions, {
    runtime: f.runtime,
    artifacts: f.artifacts,
    now: () => now
  })
  vi.spyOn(observation, 'inspectWorkerTerminal').mockResolvedValue({
    status: 'exited',
    terminal: null, terminalHandle: null,
    exact: true
  })
  vi.spyOn(release, 'releaseLocalWorker').mockResolvedValue({
    dispatchId: attemptId,
    state: 'released',
    processAction: 'none',
    archive: null
  })
})
afterEach(async () => {
  await f.close()
})
const events = (name: string) =>
  f.store.listAuditEvents({ missionId: f.mission.id }).filter((e) => e.event === name)
it('fails and releases an exited planner once without changing the Mission', async () => {
  await recovery.reconcileAttempts()
  expect(f.db.getWorkerDispatch(attemptId)?.state).toBe('failed')
  expect(events('planner.attempt_failed')).toHaveLength(1)
  expect(release.releaseLocalWorker).toHaveBeenCalledWith(f.runtime, attemptId)
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
  await recovery.reconcileAttempts()
  expect(events('planner.attempt_failed')).toHaveLength(1)
})
it('fails and releases a ready planner whose agent exited inside a live shell without a proposal', async () => {
  vi.mocked(observation.inspectWorkerTerminal).mockRestore()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: recovery reads only handle, connection and agentWait; the fixture supplies process identity separately.
  vi.spyOn(f.runtime, 'showTerminal').mockResolvedValue({
    handle: f.from,
    connected: true,
    agentWait: null
  } as Awaited<ReturnType<typeof f.runtime.showTerminal>>)
  vi.spyOn(f.runtime, 'getTerminalLivenessVerdict').mockReturnValue({
    status: 'live',
    ptyIds: ['pty-planner']
  })
  const confirm = vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(true)
  const fail = vi.spyOn(f.db, 'failDispatch')
  expect(await recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ attemptId, liveness: 'exited', action: 'attempt_failed' }]
  })
  expect(confirm).toHaveBeenCalledExactlyOnceWith(f.from)
  expect(fail).toHaveBeenCalledWith(attemptId, expect.any(String), {
    workerProcessExited: true,
    terminationReason: 'process_exited'
  })
  expect(f.db.getWorkerDispatch(attemptId)?.state).toBe('failed')
  expect(events('planner.attempt_failed')).toMatchObject([
    { after: { reason: 'no_proposal', evidence: 'shell_foreground' } }
  ])
  expect(release.releaseLocalWorker).toHaveBeenCalledWith(f.runtime, attemptId)
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
  await recovery.reconcileAttempts()
  expect(events('planner.attempt_failed')).toHaveLength(1)
  expect(confirm).toHaveBeenCalledOnce()
})
it('uses the durable unverifiable clock, then abandons/releases after tolerance', async () => {
  vi.mocked(observation.inspectWorkerTerminal).mockResolvedValue({
    status: 'unverifiable',
    exact: true,
    terminal: null, terminalHandle: null,
    reason: 'disconnected'
  })
  await recovery.reconcileAttempts()
  now += 29 * 60_000
  await recovery.reconcileAttempts()
  expect(f.db.getWorkerDispatch(attemptId)?.state).toBe('ready')
  expect(
    f.db.getAttemptObservationFacts(attemptId).filter((e) => e.facet === 'liveness')
  ).toHaveLength(1)
  now += 60_000
  await recovery.reconcileAttempts()
  expect(f.db.getWorkerDispatch(attemptId)?.state).toBe('abandoned')
  expect(events('planner.abandoned')).toHaveLength(1)
  expect(release.releaseLocalWorker).toHaveBeenCalledWith(f.runtime, attemptId)
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
})
it('enumerates planners on Mission cancellation even without a Task stage', async () => {
  vi.mocked(observation.inspectWorkerTerminal).mockResolvedValue({
    status: 'unverifiable',
    exact: true,
    terminal: null, terminalHandle: null,
    reason: 'disconnected'
  })
  expect(
    await f.call('axiom.mission.cancel', { missionId: f.mission.id, reason: 'cancel' })
  ).toMatchObject({
    ok: true,
    result: {
      mission: { status: 'CANCELED' },
      attempts: [expect.objectContaining({ attemptId, action: 'abandoned' })]
    }
  })
  expect(f.db.getWorkerDispatch(attemptId)?.state).toBe('abandoned')
  expect(release.releaseLocalWorker).toHaveBeenCalledWith(f.runtime, attemptId)
})
