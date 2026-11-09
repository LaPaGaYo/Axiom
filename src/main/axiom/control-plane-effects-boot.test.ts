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
  const recovery = vi.spyOn(plane.effects, 'recoverAtBoot').mockImplementation(async () => {
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
  await vi.advanceTimersByTimeAsync(0)
  expect(order).toEqual(['verification', 'effects', 'start', 'effects', 'resume', 'reconcile'])
  expect(start).toHaveBeenCalledOnce()
  expect(recovery).toHaveBeenCalledTimes(2)
  expect(tick).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(60_000)
  expect(recovery).toHaveBeenCalledTimes(3)
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
it('continues startup when effect recovery fails', async () => {
  const { plane, missionId } = executing()
  vi.spyOn(plane.effects, 'recoverAtBoot').mockRejectedValue(new Error('outbox unavailable'))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const start = vi.spyOn(plane.effects, 'start').mockImplementation(() => {})
  const kick = vi.spyOn(plane.effects, 'kick').mockResolvedValue(undefined)
  const reconcile = vi
    .spyOn(plane.recovery, 'reconcileAttempts')
    .mockResolvedValue({ attempts: [] })
  const verification = vi.spyOn(plane.verification, 'kick').mockResolvedValue(undefined)
  const sync = vi.spyOn(plane, 'syncConsumer')
  const resume = vi.spyOn(plane.scheduler, 'scheduleRound').mockResolvedValue({
    admitted: [],
    skipped: []
  })
  await expect(startAxiomControlPlane(runtime)).resolves.toMatchObject({
    missions: [expect.objectContaining({ id: missionId })]
  })
  await vi.advanceTimersByTimeAsync(0)
  expect(plane.started).toBe(true)
  expect(start).toHaveBeenCalledOnce()
  expect(plane.attemptReconcileTimer).toBeDefined()
  expect(reconcile).toHaveBeenCalledOnce()
  expect(verification).toHaveBeenCalledOnce()
  expect(kick).toHaveBeenCalledOnce()
  expect(sync).toHaveBeenCalledWith(missionId)
  expect(resume).toHaveBeenCalledExactlyOnceWith(missionId, 'resume')
  expect(warning).toHaveBeenCalledWith(
    '[axiom] Effect recovery incomplete; continuing Control Plane startup'
  )
  expect(warning.mock.calls.every((args) => args.length === 1)).toBe(true)
  expect(JSON.stringify(warning.mock.calls)).not.toContain('outbox unavailable')
})
it('retries unrecovered orphans on the reconcile tick', async () => {
  const plane = getAxiomControlPlane(runtime)
  const recovery = vi.spyOn(plane.effects, 'recoverAtBoot').mockResolvedValue(undefined)
  vi.spyOn(plane.effects, 'start').mockImplementation(() => {})
  const kick = vi.spyOn(plane.effects, 'kick').mockResolvedValue(undefined)
  const reconcile = vi
    .spyOn(plane.recovery, 'reconcileAttempts')
    .mockResolvedValue({ attempts: [] })
  const verification = vi.spyOn(plane.verification, 'kick').mockResolvedValue(undefined)
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(recovery).toHaveBeenCalledTimes(2)
  expect(kick).toHaveBeenCalledOnce()
  const pending = Promise.withResolvers<void>()
  recovery.mockReturnValueOnce(pending.promise)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(recovery).toHaveBeenCalledTimes(3)
  expect(kick).toHaveBeenCalledOnce()
  expect(reconcile).toHaveBeenCalledOnce()
  expect(verification).toHaveBeenCalledTimes(2)
  pending.reject(new Error('tick recovery unavailable'))
  await vi.advanceTimersByTimeAsync(0)
  expect(warning).toHaveBeenCalledOnce()
  expect(warning.mock.calls[0]).toHaveLength(1)
  expect(JSON.stringify(warning.mock.calls)).not.toContain('tick recovery unavailable')
  expect(kick).toHaveBeenCalledTimes(2)
  expect(reconcile).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(60_000)
  expect(recovery).toHaveBeenCalledTimes(4)
  expect(kick).toHaveBeenCalledTimes(3)
  expect(reconcile).toHaveBeenCalledTimes(3)
  expect(verification).toHaveBeenCalledTimes(3)
  expect(plane.started).toBe(true)
  expect(plane.attemptReconcileTimer).toBeDefined()
})
it('recovers an old lease on the reconcile tick before it can consume the unbound Attempt', async () => {
  vi.useFakeTimers({
    toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout']
  })
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
  const oldLease = new Date(Date.now() - 90_000).toISOString()
  plane.store.transaction('seed_admission', () => {
    plane.store.insertAttemptBinding({ missionId, ...payload, dispatchId: null })
    controller.transitionTaskStage({
      taskId: task.taskId,
      to: 'RUNNING',
      actor: 'Scheduler',
      reason: 'admission',
      attemptCountDelta: 1
    })
    plane.effects.enqueue({
      missionId,
      kind: 'attempt.dispatch',
      key: `${task.taskId}/1`,
      payload,
      dueAt: oldLease
    })
  })
  plane.store.leaseDueEffect({ missionId, kind: 'attempt.dispatch', now: oldLease, epoch: 'old' })
  const original = plane.store.getEffect('attempt.dispatch', `${task.taskId}/1`)
  db.db.exec(`CREATE TRIGGER reject_effect_recovery AFTER UPDATE ON axiom_effects
    BEGIN SELECT RAISE(ABORT, 'temporary write failure'); END`)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  await startAxiomControlPlane(runtime)
  await vi.advanceTimersByTimeAsync(0)
  expect(plane.store.getTaskStage(task.taskId)?.stage).toBe('RUNNING')
  expect(plane.store.getEffect('attempt.dispatch', `${task.taskId}/1`)).toEqual(original)
  expect(launch).not.toHaveBeenCalled()
  db.db.exec('DROP TRIGGER reject_effect_recovery')
  await vi.advanceTimersByTimeAsync(60_000)
  await plane.effects.kick()
  expect(launch).toHaveBeenCalledExactlyOnceWith({ missionId, ...payload })
  expect(plane.store.getEffect('attempt.dispatch', `${task.taskId}/1`)?.status).toBe('done')
  expect(plane.store.getTaskStage(task.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(plane.store.listAttemptBindings({ missionId }).map((binding) => binding.seq)).toEqual([1])
  expect(
    plane.store
      .listAuditEvents({ missionId })
      .filter((event) =>
        ['attempt.launch_pending_orphan', 'attempt.launch_failed'].includes(event.event)
      )
  ).toEqual([])
})
it.each([false, true])(
  'does not resume an obsolete reconcile tick after recovery rejects (restart=%s)',
  async (restart) => {
    const plane = getAxiomControlPlane(runtime)
    const recovery = vi.spyOn(plane.effects, 'recoverAtBoot').mockResolvedValue(undefined)
    vi.spyOn(plane.effects, 'start').mockImplementation(() => {})
    const kick = vi.spyOn(plane.effects, 'kick').mockResolvedValue(undefined)
    const reconcile = vi
      .spyOn(plane.recovery, 'reconcileAttempts')
      .mockResolvedValue({ attempts: [] })
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    await startAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(0)
    const pending = Promise.withResolvers<void>()
    recovery.mockReturnValueOnce(pending.promise)
    await vi.advanceTimersByTimeAsync(60_000)
    stopAxiomControlPlane(runtime)
    if (restart) {
      await startAxiomControlPlane(runtime)
      await vi.advanceTimersByTimeAsync(0)
    }
    const timer = plane.attemptReconcileTimer
    const expectedCalls = restart ? 2 : 1
    expect(kick).toHaveBeenCalledTimes(expectedCalls)
    expect(reconcile).toHaveBeenCalledTimes(expectedCalls)
    pending.reject(new Error('obsolete tick failed'))
    await vi.advanceTimersByTimeAsync(0)
    expect(kick).toHaveBeenCalledTimes(expectedCalls)
    expect(reconcile).toHaveBeenCalledTimes(expectedCalls)
    expect(plane.started).toBe(restart)
    expect(plane.attemptReconcileTimer).toBe(timer)
  }
)
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
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const start = vi.spyOn(plane.effects, 'start')
  const first = startAxiomControlPlane(runtime)
  const resolved = expect(first).resolves.toBeUndefined()
  await entered.promise
  stopAxiomControlPlane(runtime)
  await startAxiomControlPlane(runtime)
  const timer = plane.attemptReconcileTimer
  expect(timer).toBeDefined()
  recovering.reject(new Error('old recovery failed'))
  await resolved
  expect(warning).toHaveBeenCalledExactlyOnceWith(
    '[axiom] Effect recovery incomplete; continuing Control Plane startup'
  )
  expect(start).toHaveBeenCalledOnce()
  expect(plane.started).toBe(true)
  expect(plane.attemptReconcileTimer).toBe(timer)
})
