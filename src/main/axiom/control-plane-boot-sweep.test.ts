import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import * as e2e from '../e2e-config'
import { createInput } from './mission-controller/controller-fixture.test-support'
import { mailboxRuntime } from './mailbox-runtime.test-support'
import { getAxiomControlPlane } from './control-plane'
import { startAxiomControlPlane, stopAxiomControlPlane } from './control-plane-boot'
import { ATTEMPT_RECONCILE_INTERVAL_MS } from './recovery/recovery-service'

let directory: string
let db: OrchestrationDb
let runtime: ReturnType<typeof mailboxRuntime>

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubEnv('AXIOM_E2E_RUN_SWEEP', undefined)
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: false })
  directory = mkdtempSync(join(tmpdir(), 'axiom-boot-sweep-'))
  db = new OrchestrationDb(join(directory, 'orchestration.db'))
  runtime = mailboxRuntime(db)
})
afterEach(async () => {
  stopAxiomControlPlane(runtime)
  const plane = getAxiomControlPlane(runtime)
  await plane.effects.stop()
  await plane.verification.stop()
  db.close()
  rmSync(directory, { recursive: true, force: true })
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function mission(status: 'EXECUTING' | 'PAUSED') {
  const plane = getAxiomControlPlane(runtime)
  const { mission: created } = plane.missions.createMission(createInput)
  plane.store.updateMissionStatus({
    id: created.id,
    from: created.status,
    to: status,
    previousStatus: status === 'PAUSED' ? 'EXECUTING' : null
  })
  return created.id
}

it('every tick asks one sweep round of each executing Mission and boot asks none', async () => {
  const executing = [mission('EXECUTING'), mission('EXECUTING')]
  const paused = mission('PAUSED')
  const plane = getAxiomControlPlane(runtime)
  const schedule = vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({
    admitted: [],
    skipped: []
  })
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(schedule).toHaveBeenCalledTimes(2)
  for (const id of executing) {
    expect(schedule).toHaveBeenCalledWith(id, 'resume')
  }
  expect(schedule.mock.calls.every(([, trigger]) => trigger === 'resume')).toBe(true)
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledTimes(4)
  for (const id of executing) {
    expect(
      schedule.mock.calls.filter(([missionId, trigger]) => missionId === id && trigger === 'sweep')
    ).toHaveLength(1)
  }
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledTimes(6)
  for (const id of executing) {
    expect(
      schedule.mock.calls.filter(([missionId, trigger]) => missionId === id && trigger === 'sweep')
    ).toHaveLength(2)
  }
  expect(schedule.mock.calls.some(([missionId]) => missionId === paused)).toBe(false)
  stopAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledTimes(6)
})

it('a tick that cannot sweep leaves only a warning', async () => {
  const missionId = mission('EXECUTING')
  const plane = getAxiomControlPlane(runtime)
  const schedule = vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({
    admitted: [],
    skipped: []
  })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  schedule.mockClear()
  warn.mockClear()
  const list = plane.store.listMissions
  let fail = true
  vi.spyOn(plane.store, 'listMissions').mockImplementation((input) => {
    if (input.status === 'EXECUTING' && fail) {
      fail = false
      throw new Error('listing diagnostic detail')
    }
    return list(input)
  })
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(warn.mock.calls).toEqual([['[axiom] Scheduler sweep failed']])
  expect(schedule).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'sweep')
  warn.mockClear()
  schedule.mockClear().mockRejectedValue(new Error('round diagnostic detail'))
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'sweep')
  expect(warn.mock.calls).toEqual([
    ['[axiom] Scheduler round failed', { missionId, trigger: 'sweep' }]
  ])
})

it('the sweep is held under e2e unless a spec asks', async () => {
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: true })
  const missionId = mission('EXECUTING')
  const plane = getAxiomControlPlane(runtime)
  const schedule = vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({
    admitted: [],
    skipped: []
  })
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  schedule.mockClear()
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).not.toHaveBeenCalled()
  vi.stubEnv('AXIOM_E2E_RUN_SWEEP', '1')
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'sweep')
  schedule.mockClear()
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: false })
  vi.stubEnv('AXIOM_E2E_RUN_SWEEP', '0')
  await vi.advanceTimersByTimeAsync(ATTEMPT_RECONCILE_INTERVAL_MS)
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'sweep')
})
