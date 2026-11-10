import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { EffectOutbox } from './effect-outbox'
import { registerAttemptContinuation } from './attempt-continuation'

let f: ReturnType<typeof planned>
let effects: EffectOutbox
let taskId: string
const scheduleRound = vi.fn(async () => ({ admitted: [], skipped: [] }))
function open(epoch: string) {
  const outbox = new EffectOutbox({ db: f.db, store: f.store, epoch })
  registerAttemptContinuation({ store: f.store, effects: outbox, scheduler: { scheduleRound } })
  return outbox
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime('2026-11-09T12:00:00.000Z')
  scheduleRound.mockReset().mockResolvedValue({ admitted: [], skipped: [] })
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  taskId = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0].taskId
  f.store.insertAttemptBinding({
    missionId: f.missionId,
    taskId,
    seq: 1,
    branch: 'attempt/1',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  effects = open('first')
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  vi.useRealTimers()
})
function enqueue(delay = 0) {
  return f.store.transaction('test_continuation', () =>
    effects.enqueue({
      missionId: f.missionId,
      kind: 'attempt.continue',
      key: `${taskId}/1`,
      dueAt: new Date(Date.now() + delay).toISOString(),
      payload: { taskId, seq: 1, chain: 1, failureClass: 'usage_limit' }
    })
  )
}
const row = () => f.store.getEffect('attempt.continue', `${taskId}/1`)

it('ignores a continuation whose Task has moved on', async () => {
  enqueue()
  f.store.insertAttemptBinding({
    missionId: f.missionId,
    taskId,
    seq: 2,
    branch: 'attempt/2',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  effects.start()
  await effects.kick()
  expect(scheduleRound).not.toHaveBeenCalled()
  expect(row()?.status).toBe('done')
})
it.each(['paused', 'canceled', 'running', 'missing'] as const)(
  'ignores continuation for %s durable state',
  async (state) => {
    enqueue()
    if (state === 'paused') {
      f.controller.pauseMission(f.missionId, 'test pause')
    }
    if (state === 'canceled') {
      f.controller.cancelMission(f.missionId, 'test cancel')
    }
    if (state === 'running') {
      f.store.updateTaskStage({ taskId, from: 'READY', to: 'RUNNING', attemptCountDelta: 1 })
    }
    if (state === 'missing') {
      f.db.db.prepare('DELETE FROM task_stages WHERE task_id = ?').run(taskId)
    }
    effects.start()
    await effects.kick()
    expect(scheduleRound).not.toHaveBeenCalled()
    expect(row()?.status).toBe('done')
  }
)
it('fires a durable pending continuation after a new outbox starts at its due time', async () => {
  enqueue(60000)
  effects.start()
  await effects.kick()
  await effects.stop()
  effects = open('restarted')
  await effects.recoverAtBoot()
  effects.start()
  await effects.kick()
  await vi.advanceTimersByTimeAsync(59999)
  expect(scheduleRound).not.toHaveBeenCalled()
  await vi.advanceTimersByTimeAsync(1)
  await effects.kick()
  expect(scheduleRound).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
  expect(row()?.status).toBe('done')
})
it('retries an orphaned continuation without changing the Attempt sequence', async () => {
  enqueue()
  f.store.leaseDueEffect({
    kind: 'attempt.continue',
    missionId: f.missionId,
    epoch: 'old',
    now: new Date().toISOString()
  })
  await effects.recoverAtBoot()
  expect(row()?.status).toBe('pending')
  effects.start()
  await effects.kick()
  expect(scheduleRound).toHaveBeenCalledOnce()
  expect(f.store.nextAttemptSeq(taskId)).toBe(2)
})
it('exhausts throwing rounds after 1s and 5s and leaves the Task READY', async () => {
  scheduleRound.mockRejectedValue(new Error('round unavailable'))
  enqueue()
  effects.start()
  await effects.kick()
  await vi.advanceTimersByTimeAsync(1000)
  await vi.advanceTimersByTimeAsync(5000)
  await effects.kick()
  expect(scheduleRound).toHaveBeenCalledTimes(3)
  expect(row()).toMatchObject({ status: 'failed', attempts: 3 })
  expect(f.store.getTaskStage(taskId)?.stage).toBe('READY')
})
