import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { mailboxRuntime } from './mailbox-runtime.test-support'
import { getAxiomControlPlane } from './control-plane'
import { startAxiomControlPlane, stopAxiomControlPlane } from './control-plane-boot'
import { MissionController } from './mission-controller/mission-controller'
import { planned } from './mission-controller/controller-fixture.test-support'
import * as launcher from './execution/attempt-launcher'

let db: OrchestrationDb
let runtime: ReturnType<typeof mailboxRuntime>
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] })
  db = new OrchestrationDb(':memory:')
  runtime = mailboxRuntime(db)
})
afterEach(async () => {
  stopAxiomControlPlane(runtime)
  await getAxiomControlPlane(runtime).effects.stop()
  db.close()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function executing() {
  const plane = getAxiomControlPlane(runtime)
  const controller = new MissionController(db, plane.store)
  const f = planned({ db, store: plane.store, controller })
  controller.startExecution(f.missionId)
  return { ...f, plane }
}
it('recovers and starts effects before initial reconciliation and resume, then includes the timer and stop', async () => {
  const { plane } = executing()
  const order: string[] = []
  vi.spyOn(plane.verification, 'recoverAtBoot').mockImplementation(async () => {
    order.push('verification')
  })
  vi.spyOn(plane.effects, 'recoverAtBoot').mockImplementation(async () => {
    order.push('effects')
  })
  const start = vi.spyOn(plane.effects, 'start').mockImplementation(() => {
    order.push('start')
  })
  const tick = vi.spyOn(plane.effects, 'kick').mockResolvedValue(undefined)
  vi.spyOn(plane.recovery, 'reconcileAttempts').mockImplementation(async () => {
    order.push('reconcile')
    return { attempts: [] }
  })
  vi.spyOn(plane.scheduler, 'scheduleRound').mockImplementation(async () => {
    order.push('resume')
    return { admitted: [], skipped: [] }
  })
  const stop = vi.spyOn(plane.effects, 'stop')
  await startAxiomControlPlane(runtime)
  expect(order).toEqual(['verification', 'effects', 'start', 'reconcile', 'resume'])
  expect(start).toHaveBeenCalledOnce()
  expect(tick).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(tick).toHaveBeenCalledTimes(2)
  stopAxiomControlPlane(runtime)
  expect(stop).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(tick).toHaveBeenCalledTimes(2)
})
it.each([false, true])(
  'does not activate an obsolete effect recovery after stop (restart=%s)',
  async (restart) => {
    const plane = getAxiomControlPlane(runtime)
    const recovering = Promise.withResolvers<void>()
    const entered = Promise.withResolvers<void>()
    vi.spyOn(plane.effects, 'recoverAtBoot').mockImplementation(async () => {
      entered.resolve()
      await recovering.promise
    })
    const start = vi.spyOn(plane.effects, 'start')
    const boot = startAxiomControlPlane(runtime)
    await entered.promise
    stopAxiomControlPlane(runtime)
    const next = restart ? startAxiomControlPlane(runtime) : Promise.resolve()
    recovering.resolve()
    await Promise.all([boot, next])
    expect(start).toHaveBeenCalledTimes(restart ? 1 : 0)
    expect(plane.started).toBe(restart)
    expect(plane.attemptReconcileTimer !== undefined).toBe(restart)
  }
)
it('does not schedule after effect recovery fails and permits a later boot', async () => {
  const plane = getAxiomControlPlane(runtime)
  vi.spyOn(plane.effects, 'recoverAtBoot').mockRejectedValueOnce(new Error('outbox unavailable'))
  const start = vi.spyOn(plane.effects, 'start')
  const reconcile = vi.spyOn(plane.recovery, 'reconcileAttempts')
  await expect(startAxiomControlPlane(runtime)).rejects.toThrow('outbox unavailable')
  expect(plane.started).toBe(false)
  expect(start).not.toHaveBeenCalled()
  expect(reconcile).not.toHaveBeenCalled()
  await startAxiomControlPlane(runtime)
  expect(plane.started).toBe(true)
  expect(start).toHaveBeenCalledOnce()
})
it('launches a previously committed admission exactly once on boot', async () => {
  const launch = vi.fn(async () => {})
  vi.spyOn(launcher, 'createAttemptLauncher').mockReturnValue(launch)
  const { plane, missionId, controller } = executing()
  vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({ admitted: [], skipped: [] })
  const task = plane.store.listTaskStages({ missionId, stage: 'READY' })[0]
  const payload = {
    taskId: task.taskId,
    seq: 1,
    branch: `axiom/attempt/${task.taskId}/1`,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  }
  plane.store.transaction('seed_admission', () => {
    plane.store.insertAttemptBinding({ missionId, ...payload, dispatchId: null })
    controller.transitionTaskStage({
      taskId: task.taskId,
      to: 'RUNNING',
      actor: 'Scheduler',
      reason: 'admission',
      attemptCountDelta: 1
    })
    plane.effects.enqueue({ missionId, kind: 'attempt.dispatch', key: `${task.taskId}/1`, payload })
  })
  expect(launch).not.toHaveBeenCalled()
  await startAxiomControlPlane(runtime)
  await plane.effects.kick()
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(launch).toHaveBeenCalledExactlyOnceWith({ missionId, ...payload })
  expect(plane.store.getEffect('attempt.dispatch', `${task.taskId}/1`)?.status).toBe('done')
})

it('keeps the newer boot active when an older effect recovery rejects', async () => {
  const plane = getAxiomControlPlane(runtime)
  const recovering = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  vi.spyOn(plane.effects, 'recoverAtBoot').mockImplementationOnce(async () => {
    entered.resolve()
    await recovering.promise
  })
  const first = startAxiomControlPlane(runtime)
  const rejected = expect(first).rejects.toThrow('old recovery failed')
  await entered.promise
  stopAxiomControlPlane(runtime)
  await startAxiomControlPlane(runtime)
  const timer = plane.attemptReconcileTimer
  recovering.reject(new Error('old recovery failed'))
  await rejected
  expect(plane.started).toBe(true)
  expect(plane.attemptReconcileTimer).toBe(timer)
})
