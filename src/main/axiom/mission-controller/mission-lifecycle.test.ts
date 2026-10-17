import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  MISSION_STATUSES,
  TERMINAL_MISSION_STATUSES
} from '../../../shared/axiom-contract/lifecycle'
import { actor, createInput, fixture, planned, propose } from './controller-fixture.test-support'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})

it.each(
  MISSION_STATUSES.filter(
    (status) =>
      !TERMINAL_MISSION_STATUSES.has(status) && status !== 'PAUSED' && status !== 'BLOCKED'
  )
)('restores exact %s from pause and block', (status) => {
  const { mission } = f.controller.createMission(createInput)
  f.store.updateMissionStatus({
    id: mission.id,
    from: 'ANALYZING',
    to: status,
    previousStatus: null
  })
  f.controller.pauseMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({
    status: 'PAUSED',
    previousStatus: status
  })
  f.controller.resumeMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({ status, previousStatus: null })
  f.controller.blockMission(mission.id, 'waiting')
  expect(f.controller.getMission(mission.id)).toMatchObject({
    status: 'BLOCKED',
    previousStatus: status
  })
  f.controller.unblockMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({ status, previousStatus: null })
})

it('unwinds nested pause/block without losing the original return state', () => {
  const { mission } = f.controller.createMission(createInput)
  f.controller.pauseMission(mission.id)
  f.controller.blockMission(mission.id, 'waiting')
  f.controller.pauseMission(mission.id)
  f.controller.resumeMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({
    status: 'BLOCKED',
    previousStatus: 'PAUSED'
  })
  f.controller.unblockMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({
    status: 'PAUSED',
    previousStatus: 'ANALYZING'
  })
  f.controller.resumeMission(mission.id)
  expect(f.controller.getMission(mission.id)).toMatchObject({
    status: 'ANALYZING',
    previousStatus: null
  })
})

it.each(MISSION_STATUSES)(
  'checks public Mission commands from %s without changing illegal states',
  (status) => {
    const { mission } = f.controller.createMission(createInput)
    for (const command of ['pause', 'block', 'cancel', 'resume', 'unblock', 'start'] as const) {
      const current = f.controller.getMission(mission.id)
      f.store.updateMissionStatus({
        id: mission.id,
        from: current.status,
        to: status,
        previousStatus: status === 'PAUSED' || status === 'BLOCKED' ? 'ANALYZING' : null
      })
      const before = f.controller.getMission(mission.id)
      const events = f.store.listAuditEvents({ missionId: mission.id })
      const action = () => {
        if (command === 'pause') {
          return f.controller.pauseMission(mission.id)
        }
        if (command === 'block') {
          return f.controller.blockMission(mission.id, 'waiting')
        }
        if (command === 'cancel') {
          return f.controller.cancelMission(mission.id, 'cancel')
        }
        if (command === 'resume') {
          return f.controller.resumeMission(mission.id)
        }
        if (command === 'unblock') {
          return f.controller.unblockMission(mission.id)
        }
        return f.controller.startExecution(mission.id)
      }
      const legal =
        command === 'resume'
          ? status === 'PAUSED'
          : command === 'unblock'
            ? status === 'BLOCKED'
            : command === 'start'
              ? status === 'PLANNED'
              : !TERMINAL_MISSION_STATUSES.has(status) &&
                !(command === 'pause' && status === 'PAUSED') &&
                !(command === 'block' && status === 'BLOCKED')
      if (legal) {
        action()
      } else {
        expect(action).toThrowError(
          expect.objectContaining({
            code:
              command === 'start' && status === 'EXECUTING' ? 'stale_state' : 'illegal_transition'
          })
        )
        expect(f.controller.getMission(mission.id)).toEqual(before)
        expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
      }
    }
  }
)

it('cancel cascades only nonterminal Tasks, preserves the Run, and records the rationale', () => {
  const { missionId } = planned(f)
  const tasks = f.controller.listTasks({ missionId })
  f.store.updateTaskStage({ taskId: tasks[0].taskId, from: 'DEFINED', to: 'INTEGRATED' })
  f.controller.cancelTask({ taskId: tasks[1].taskId, rationale: 'individual cancel', actor })
  f.controller.cancelMission(missionId, 'stop this Mission')
  expect(f.controller.getMission(missionId)).toMatchObject({
    status: 'CANCELED',
    countTaskStages: { CANCELED: 11, INTEGRATED: 1 }
  })
  expect(f.db.getRun(f.controller.getMission(missionId).runId)).toBeDefined()
  expect(f.store.listAuditEvents({ missionId }).at(-1)?.after).toMatchObject({
    reason: 'stop this Mission'
  })
})

it('rolls back the whole cascade when any Task CAS fails', () => {
  const { missionId } = planned(f)
  const tasks = f.controller.listTasks({ missionId })
  const events = f.store.listAuditEvents({ missionId })
  const original = f.store.updateTaskStage
  vi.spyOn(f.store, 'updateTaskStage').mockImplementation((p) =>
    p.taskId === tasks[1].taskId ? false : original(p)
  )
  expect(() => f.controller.cancelMission(missionId, 'cancel')).toThrowError(
    expect.objectContaining({ code: 'stale_state' })
  )
  expect(f.controller.listTasks({ missionId })).toEqual(tasks)
  expect(f.controller.getMission(missionId).status).toBe('PLANNED')
  expect(f.store.listAuditEvents({ missionId })).toEqual(events)
})

it('reports missing objects and refuses proposal or approval while paused', () => {
  expect(() => f.controller.getMission('missing')).toThrowError(
    expect.objectContaining({ code: 'mission_not_found' })
  )
  expect(() => f.controller.recomputeReadiness('missing')).toThrowError(
    expect.objectContaining({ code: 'mission_not_found' })
  )
  expect(() =>
    f.controller.rejectPlan({ planRevisionId: 'missing', reason: 'scope', resolver: actor })
  ).toThrowError(expect.objectContaining({ code: 'plan_revision_not_found' }))
  expect(() =>
    f.controller.cancelTask({ taskId: 'missing', actor, rationale: 'cancel' })
  ).toThrowError(expect.objectContaining({ code: 'task_not_found' }))
  const { mission, goalRevision } = f.controller.createMission(createInput)
  f.controller.pauseMission(mission.id)
  expect(() => propose(f.controller, mission.id, goalRevision.id)).toThrowError(
    expect.objectContaining({ code: 'illegal_transition' })
  )
})
