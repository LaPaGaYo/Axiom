import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from './controller-fixture.test-support'
import { MissionController } from './mission-controller'

let f: ReturnType<typeof planned>
let otherId: string
let taskId: string
const triggered = vi.fn()
beforeEach(() => {
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  const other = planned({ ...f, controller: new MissionController(f.db, f.store) })
  other.controller.startExecution(other.missionId)
  otherId = other.missionId
  const paused = planned({ ...f, controller: new MissionController(f.db, f.store) })
  paused.controller.startExecution(paused.missionId)
  paused.controller.pauseMission(paused.missionId)
  taskId = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0].taskId
  triggered.mockReset().mockImplementation(() => expect(f.db.db.isTransaction).toBe(false))
  f.controller = new MissionController(f.db, f.store, { onScheduleTrigger: triggered })
})
afterEach(() => f.db.close())
function enqueue(failureClass: 'usage_limit' | 'provider_error' = 'usage_limit') {
  f.store.transaction('test_continuation', () =>
    f.store.enqueueEffect({
      kind: 'attempt.continue',
      missionId: f.missionId,
      key: `${taskId}/1`,
      dueAt: '2099-11-10T12:01:00.000Z',
      payload: { taskId, seq: 1, chain: 1, failureClass }
    })
  )
}
const adjust = () =>
  f.controller.adjustTask({ taskId, actor: 'user', rationale: 'Account restored' })
it('wakes the other Missions when a person lifts a usage-limit wait', async () => {
  enqueue()
  f.store.transaction('outer_adjust', () => {
    expect(adjust().stage).toBe('READY')
    expect(triggered).not.toHaveBeenCalled()
  })
  await Promise.resolve()
  expect(triggered.mock.calls).toEqual([
    [f.missionId, 'stage_change'],
    [otherId, 'stage_change']
  ])
  expect(f.store.getEffect('attempt.continue', `${taskId}/1`)?.status).toBe('retired')
})
it.each(['absent', 'provider_error', 'retired'])(
  'does not wake other Missions when the wait is %s',
  (state) => {
    if (state !== 'absent') {
      enqueue(state === 'provider_error' ? 'provider_error' : 'usage_limit')
    }
    if (state === 'retired') {
      adjust()
      triggered.mockClear()
    }
    adjust()
    expect(triggered).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
  }
)
it('suppresses all cross-Mission triggers when the outer adjustment rolls back', async () => {
  enqueue()
  expect(() =>
    f.store.transaction('rollback_adjust', () => {
      adjust()
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  await Promise.resolve()
  expect(triggered).not.toHaveBeenCalled()
  expect(f.store.getEffect('attempt.continue', `${taskId}/1`)?.status).toBe('pending')
})
