import { afterEach, expect, it } from 'vitest'
import { fixture } from '../mission-controller/controller-fixture.test-support'

const f = fixture()
afterEach(() => f.db.close())

it('persists ordered bindings, validates rows, and rolls back sequence allocation', () => {
  const binding = {
    missionId: 'mission',
    taskId: 'task',
    seq: 1,
    branch: 'axiom/attempt/task/1',
    agentSpecId: 'spec',
    contextPackageId: 'context',
    dispatchId: null
  }
  expect(f.store.nextAttemptSeq('task')).toBe(1)
  expect(f.store.getAttemptBinding('task', 1)).toBeUndefined()
  f.store.insertAttemptBinding(binding)
  expect(f.store.getAttemptBinding('task', 1)).toMatchObject(binding)
  expect(f.store.nextAttemptSeq('task')).toBe(2)
  expect(() => f.store.insertAttemptBinding(binding)).toThrow()
  expect(() =>
    f.store.transaction('binding_test', () => {
      f.store.insertAttemptBinding({ ...binding, seq: 2, branch: 'axiom/attempt/task/2' })
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  expect(f.store.nextAttemptSeq('task')).toBe(2)
  f.store.insertAttemptBinding({
    ...binding,
    seq: 2,
    branch: 'axiom/attempt/task/2',
    dispatchId: 'dispatch'
  })
  expect(() =>
    f.store.insertAttemptBinding({ ...binding, taskId: 'other', dispatchId: 'dispatch' })
  ).toThrow()
  expect(
    f.store.listAttemptBindings({ missionId: 'mission', taskId: 'task' }).map((b) => b.seq)
  ).toEqual([1, 2])
  expect(f.store.listAttemptBindings({ missionId: 'other' })).toEqual([])
  expect(f.store.listAttemptBindings({ missionId: 'mission', taskId: 'other' })).toEqual([])
  expect(() => f.store.insertAttemptBinding({ ...binding, seq: 0 })).toThrow()
  f.db.db.prepare('UPDATE attempt_bindings SET seq = 0 WHERE seq = 1').run()
  expect(() => f.store.listAttemptBindings({ missionId: 'mission' })).toThrow()
})
