import { afterEach, expect, it } from 'vitest'
import { planned } from '../mission-controller/controller-fixture.test-support'

const f = planned()
afterEach(() => f.db.close())
it('updates both Task spec and retry policy only at the expected stage', () => {
  const task = f.store.listTaskStages({ missionId: f.missionId })[0]!
  const retryPolicy = { maxAttempts: 4 }
  const spec = { ...task.spec, scope: { allowedPaths: ['added.ts'] }, retryPolicy }
  expect(
    f.store.updateTaskSpec({ taskId: task.taskId, expectedStage: 'READY', spec, retryPolicy })
  ).toBe(false)
  expect(f.store.getTaskStage(task.taskId)).toEqual(task)
  expect(
    f.store.updateTaskSpec({ taskId: task.taskId, expectedStage: 'DEFINED', spec, retryPolicy })
  ).toBe(true)
  expect(f.store.getTaskStage(task.taskId)).toMatchObject({ stage: 'DEFINED', spec, retryPolicy })
})
