import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { EffectOutbox } from './effect-outbox'
import { registerMissionEffectExecutors } from './mission-effect-executors'
import { MissionController } from '../mission-controller/mission-controller'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import * as e2e from '../../e2e-config'

let f: ReturnType<typeof planned>
let effects: EffectOutbox
let attempt: AdmittedAttempt
let launch: ReturnType<typeof vi.fn<(attempt: AdmittedAttempt) => Promise<void>>>
let kick: ReturnType<typeof vi.fn<() => Promise<void>>>
beforeEach(() => {
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  attempt = {
    missionId: f.missionId,
    taskId: task.taskId,
    seq: 1,
    branch: `axiom/attempt/${task.taskId}/1`,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  }
  f.store.insertAttemptBinding({ ...attempt, dispatchId: null })
  f.controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'RUNNING',
    actor: 'Scheduler',
    reason: 'admission',
    attemptCountDelta: 1
  })
  launch = vi.fn(async () => {})
  kick = vi.fn(async () => {})
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'current' })
  registerMissionEffectExecutors({
    db: f.db,
    store: f.store,
    missions: f.controller,
    effects,
    launch,
    verification: { kick }
  })
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
function enqueue() {
  const { missionId, ...payload } = attempt
  return f.store.transaction('test_dispatch', () =>
    effects.enqueue({ missionId, kind: 'attempt.dispatch', key: `${attempt.taskId}/1`, payload })
  )
}
function orphan() {
  enqueue()
  const effect = f.store.leaseDueEffect({
    kind: 'attempt.dispatch',
    missionId: f.missionId,
    now: new Date().toISOString(),
    epoch: 'previous'
  })
  if (!effect) {
    throw new Error('Expected a leased dispatch effect')
  }
  return effect
}
const row = () => f.store.getEffect('attempt.dispatch', `${attempt.taskId}/1`)

it('launches a persisted admission exactly once after boot', async () => {
  enqueue()
  await effects.kick()
  expect(launch).not.toHaveBeenCalled()
  await effects.recoverAtBoot()
  effects.start()
  await effects.kick()
  await effects.recoverAtBoot()
  await effects.kick()
  expect(launch).toHaveBeenCalledExactlyOnceWith(attempt)
  expect(row()?.status).toBe('done')
})
it('settles a thrown launch once with the original Scheduler audit, without relaunch', async () => {
  enqueue()
  launch.mockRejectedValue(new Error('launch failed'))
  effects.start()
  await effects.kick()
  await effects.kick()
  await effects.recoverAtBoot()
  expect(launch).toHaveBeenCalledOnce()
  expect(row()).toMatchObject({ status: 'failed', attempts: 1 })
  expect(f.store.getTaskStage(attempt.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  const audits = f.store.listAuditEvents({ missionId: f.missionId })
  expect(audits.filter((e) => e.event === 'attempt.launch_failed')).toEqual([
    expect.objectContaining({
      actor: 'Scheduler',
      objectKind: 'attempt',
      objectId: `${attempt.taskId}/1`,
      before: null,
      after: { reason: 'launch_rejected' },
      createdAt: expect.any(String)
    })
  ])
  expect(
    audits.filter(
      (e) =>
        e.event === 'task.stage' &&
        e.after &&
        typeof e.after === 'object' &&
        'reason' in e.after &&
        e.after.reason === 'launch_rejected'
    )
  ).toHaveLength(1)
})
it.each(['bound', 'unknown', 'absent'] as const)(
  'recovers a %s dispatch outcome without duplicate dispatch',
  async (outcome) => {
    const effect = orphan()
    let dispatchId: string | null = null
    if (outcome !== 'absent') {
      const { dispatch } = f.db.createStartingWorkerDispatch({
        taskId: attempt.taskId,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {}
      })
      dispatchId = dispatch.id
      if (outcome === 'bound') {
        f.store.bindAttemptDispatch(attempt.taskId, 1, dispatch.id)
      }
    }
    await effects.recoverAtBoot()
    expect(row()).toMatchObject(
      outcome === 'bound'
        ? { status: 'done' }
        : outcome === 'unknown'
          ? { status: 'retired', lastError: 'dispatch_outcome_unknown' }
          : { status: 'pending' }
    )
    expect(f.store.getAttemptBinding(attempt.taskId, 1)).toMatchObject({
      seq: 1,
      dispatchId: outcome === 'bound' ? dispatchId : null
    })
    expect(f.store.getTaskStage(attempt.taskId)).toMatchObject({
      stage: 'RUNNING',
      attemptCount: 1
    })
    const dispatch = f.db.getDispatchContext(attempt.taskId)
    if (outcome === 'absent') {
      expect(dispatch).toBeUndefined()
    } else {
      expect(dispatch).toMatchObject({ id: dispatchId, status: 'pending' })
      expect(f.store.getAttemptBindingByDispatch(dispatchId ?? '')?.taskId).toBe(
        outcome === 'bound' ? attempt.taskId : undefined
      )
    }
    expect(
      f.store
        .listAuditEvents({ missionId: f.missionId })
        .filter((event) => event.event === 'effect.retired')
    ).toEqual(
      outcome === 'unknown'
        ? [
            expect.objectContaining({
              actor: 'EffectOutbox',
              objectKind: 'effect',
              objectId: effect.id,
              before: null,
              after: {
                kind: 'attempt.dispatch',
                key: `${attempt.taskId}/1`,
                reason: 'dispatch_outcome_unknown'
              }
            })
          ]
        : []
    )
    effects.start()
    await effects.kick()
    expect(launch).toHaveBeenCalledTimes(outcome === 'absent' ? 1 : 0)
  }
)
it('retries when the latest dispatch already belongs to an older binding', async () => {
  orphan()
  const { dispatch } = f.db.createStartingWorkerDispatch({
    taskId: attempt.taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: {}
  })
  f.store.insertAttemptBinding({
    ...attempt,
    taskId: 'older-task',
    branch: 'older-branch',
    dispatchId: dispatch.id
  })
  await effects.recoverAtBoot()
  expect(row()?.status).toBe('pending')
})
it('finishes the verification wake without awaiting the verification drain', async () => {
  const drain = Promise.withResolvers<void>()
  kick.mockReturnValue(drain.promise)
  f.store.transaction('test_verification', () =>
    effects.enqueue({
      missionId: f.missionId,
      kind: 'verification.enqueue',
      key: 'run',
      payload: { runId: 'run' }
    })
  )
  effects.start()
  await effects.kick()
  expect(kick).toHaveBeenCalledExactlyOnceWith()
  expect(f.store.getEffect('verification.enqueue', 'run')?.status).toBe('done')
  drain.resolve()
})
it.each([true, false])(
  'holds dispatch only with enabled E2E configuration (%s)',
  async (enabled) => {
    vi.stubEnv('AXIOM_E2E_HOLD_ATTEMPT_DISPATCH', '1')
    vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled })
    enqueue()
    effects.start()
    await effects.kick()
    expect(launch).toHaveBeenCalledTimes(enabled ? 0 : 1)
    expect(row()).toMatchObject({ status: enabled ? 'pending' : 'done', attempts: 0 })
  }
)

it('lets another Mission dispatch while the first Mission launch is awaiting the host', async () => {
  const second = planned({
    db: f.db,
    store: f.store,
    controller: new MissionController(f.db, f.store)
  })
  second.controller.startExecution(second.missionId)
  const task = second.store.listTaskStages({ missionId: second.missionId, stage: 'READY' })[0]
  const release = Promise.withResolvers<void>()
  const entered = Promise.withResolvers<void>()
  launch.mockImplementation(async (admission) => {
    if (admission.missionId === f.missionId) {
      await release.promise
    } else {
      entered.resolve()
    }
  })
  enqueue()
  const payload = {
    taskId: task.taskId,
    seq: 1,
    branch: `axiom/attempt/${task.taskId}/1`,
    agentSpecId: attempt.agentSpecId,
    contextPackageId: attempt.contextPackageId
  }
  f.store.transaction('second_dispatch', () => {
    f.store.insertAttemptBinding({ missionId: second.missionId, ...payload, dispatchId: null })
    second.controller.transitionTaskStage({
      taskId: task.taskId,
      to: 'RUNNING',
      actor: 'Scheduler',
      reason: 'admission',
      attemptCountDelta: 1
    })
    effects.enqueue({
      missionId: second.missionId,
      kind: 'attempt.dispatch',
      key: `${task.taskId}/1`,
      payload
    })
  })
  effects.start()
  try {
    await entered.promise
    await vi.waitFor(() =>
      expect(f.store.getEffect('attempt.dispatch', `${task.taskId}/1`)?.status).toBe('done')
    )
    expect(row()?.status).toBe('running')
    expect(launch).toHaveBeenCalledTimes(2)
  } finally {
    release.resolve()
    await effects.kick()
  }
})
it('retries an orphaned verification wake after boot', async () => {
  f.store.transaction('verification_wake', () =>
    effects.enqueue({
      missionId: f.missionId,
      kind: 'verification.enqueue',
      key: 'run',
      payload: { runId: 'run' }
    })
  )
  f.store.leaseDueEffect({
    kind: 'verification.enqueue',
    missionId: f.missionId,
    now: new Date().toISOString(),
    epoch: 'previous'
  })
  await effects.recoverAtBoot()
  expect(f.store.getEffect('verification.enqueue', 'run')?.status).toBe('pending')
  effects.start()
  await effects.kick()
  expect(kick).toHaveBeenCalledOnce()
  expect(f.store.getEffect('verification.enqueue', 'run')?.status).toBe('done')
})
it('bounds synchronous verification wake failures to three tries with 1s and 5s backoff', async () => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  kick.mockImplementation(() => {
    throw new Error('wake unavailable')
  })
  f.store.transaction('verification_wake', () =>
    effects.enqueue({
      missionId: f.missionId,
      kind: 'verification.enqueue',
      key: 'run',
      payload: { runId: 'run' }
    })
  )
  effects.start()
  await effects.kick()
  expect(kick).toHaveBeenCalledTimes(1)
  expect(f.store.getEffect('verification.enqueue', 'run')).toMatchObject({
    status: 'pending',
    attempts: 1
  })
  await vi.advanceTimersByTimeAsync(999)
  expect(kick).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(kick).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(4999)
  expect(kick).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  await effects.kick()
  expect(kick).toHaveBeenCalledTimes(3)
  expect(f.store.getEffect('verification.enqueue', 'run')).toMatchObject({
    status: 'failed',
    attempts: 3
  })
})
