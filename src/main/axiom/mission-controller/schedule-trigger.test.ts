import { afterEach, expect, it, vi } from 'vitest'
import { fixture, planned } from './controller-fixture.test-support'
import { MissionController } from './mission-controller'

const f = planned(fixture())
afterEach(() => f.db.close())

it('triggers only committed lifecycle changes and rejects unmarked RUNNING writes', async () => {
  const trigger = vi.fn((missionId: string, _trigger: string) => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(f.store.getMission(missionId)?.status).toBe('EXECUTING')
  })
  const missions = new MissionController(f.db, f.store, { onScheduleTrigger: trigger })
  missions.startExecution(f.missionId)
  expect(trigger).toHaveBeenLastCalledWith(f.missionId, 'mission_start')
  expect(missions.recomputeReadiness(f.missionId)).toEqual([])
  expect(trigger).toHaveBeenCalledTimes(1)
  const root = missions.listTasks({ missionId: f.missionId, stage: 'READY' })[0]
  for (const marker of [{}, { actor: 'Scheduler' }, { attemptCountDelta: 1 }]) {
    expect(() =>
      missions.transitionTaskStage({
        taskId: root.taskId,
        to: 'RUNNING',
        reason: 'bypass',
        actor: 'test',
        ...marker
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'illegal_transition',
        data: expect.objectContaining({ reason: 'admission_required' })
      })
    )
  }
  expect(trigger).toHaveBeenCalledTimes(1)
  missions.cancelTask({ taskId: root.taskId, rationale: 'remove', actor: 'test' })
  expect(trigger).toHaveBeenLastCalledWith(f.missionId, 'stage_change')
  missions.pauseMission(f.missionId)
  missions.resumeMission(f.missionId)
  expect(trigger).toHaveBeenLastCalledWith(f.missionId, 'resume')
  missions.blockMission(f.missionId, 'question')
  missions.unblockMission(f.missionId)
  expect(trigger).toHaveBeenLastCalledWith(f.missionId, 'resume')
  const other = missions.listTasks({ missionId: f.missionId, stage: 'READY' })[0]
  trigger.mockClear()
  expect(() =>
    f.store.transaction('outer_rollback', () => {
      missions.transitionTaskStage({
        taskId: other.taskId,
        to: 'BLOCKED',
        reason: 'blocked',
        actor: 'test'
      })
      expect(trigger).not.toHaveBeenCalled()
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  await Promise.resolve()
  expect(trigger).not.toHaveBeenCalled()
  f.store.transaction('outer_commit', () => {
    missions.transitionTaskStage({
      taskId: other.taskId,
      to: 'BLOCKED',
      reason: 'blocked',
      actor: 'test'
    })
    expect(trigger).not.toHaveBeenCalled()
  })
  await Promise.resolve()
  expect(trigger).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
  const third = missions.listTasks({ missionId: f.missionId, stage: 'READY' })[0]
  f.store.updateTaskStage({ taskId: third.taskId, from: 'READY', to: 'DEFINED' })
  trigger.mockClear()
  expect(missions.recomputeReadiness(f.missionId)).toEqual([third.taskId])
  expect(trigger).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
})
