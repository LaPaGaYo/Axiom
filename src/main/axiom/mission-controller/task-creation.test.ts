import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planned } from './controller-fixture.test-support'
import {
  provenance,
  makeProposal
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { MissionController } from './mission-controller'

let f: ReturnType<typeof planned>
beforeEach(() => {
  f = planned()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
function input() {
  const { id: _id, ...task } = makeProposal().tasks[0]!
  const dependsOn: string[] = []
  return {
    missionId: f.missionId,
    task: { ...task, title: 'New task', scope: { allowedPaths: ['new.ts'] } },
    dependsOn,
    provenance
  }
}
it('extends the approved graph without altering the proposal and records origin/evidence', () => {
  const before = f.store.getPlanRevision(f.planId)
  const parent = f.store.listTaskStages({ missionId: f.missionId })[0]!
  const result = f.controller.createTask({ ...input(), dependsOn: [parent.taskId, parent.taskId] })
  expect(result).toMatchObject({
    stage: 'DEFINED',
    missionId: f.missionId,
    planRevisionId: f.planId,
    attemptCount: 0
  })
  expect(f.db.getTask(result.taskId)?.deps).toBe('[]')
  expect(f.store.listUpstreamEdges(result.taskId)).toEqual([
    expect.objectContaining({
      fromTaskId: parent.taskId,
      toTaskId: result.taskId,
      readinessThreshold: 'INTEGRATED'
    })
  ])
  expect(f.store.getPlanRevision(f.planId)).toEqual(before)
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'task.created',
        objectId: result.taskId,
        after: expect.objectContaining({ stage: 'DEFINED', origin: 'user', provenance })
      }),
      expect.objectContaining({
        event: 'plan.minor_adjustment',
        objectId: f.planId,
        after: expect.objectContaining({
          classification: 'MINOR_ADJUSTMENT',
          origin: 'user',
          taskId: result.taskId
        })
      })
    ])
  )
})
it.each(['duplicate', 'dependency', 'budget'] as const)(
  'rejects %s atomically for user creation',
  (check) => {
    const p = input()
    if (check === 'duplicate') {
      p.task.title = ' SPRINT VALIDATION '
    }
    if (check === 'dependency') {
      p.dependsOn = ['foreign-task']
    }
    if (check === 'budget') {
      const task = f.store.listTaskStages({ missionId: f.missionId })[0]!
      f.store.updateTaskStage({
        taskId: task.taskId,
        from: 'DEFINED',
        to: 'RUNNING',
        attemptCountDelta: 1
      })
      f.store.upsertPolicy(f.missionId, {
        ...f.store.getPolicy(f.missionId)!,
        budget: { maxAttempts: 1 }
      })
    }
    const before = ['tasks', 'task_stages', 'mission_task_edges', 'audit_events'].map((table) =>
      f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    )
    expect(() => f.controller.createTask(p)).toThrow(
      expect.objectContaining({ code: 'invalid_argument', data: { failed: [check] } })
    )
    expect(
      ['tasks', 'task_stages', 'mission_task_edges', 'audit_events'].map((table) =>
        f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
      )
    ).toEqual(before)
  }
)
it('rejects a graph with a cycle without creating rows', () => {
  const edge = f.store.listTaskEdges(f.missionId)[0]!
  f.store.insertTaskEdges(f.missionId, f.planId, [
    { fromTaskId: edge.toTaskId, toTaskId: edge.fromTaskId, readinessThreshold: 'INTEGRATED' }
  ])
  expect(() => f.controller.createTask(input())).toThrow(
    expect.objectContaining({ data: { failed: ['dependency'] } })
  )
  expect(f.store.listTaskStages({ missionId: f.missionId })).toHaveLength(12)
})
it('makes a new root READY and triggers scheduling only after commit', async () => {
  f.controller.startExecution(f.missionId)
  const onScheduleTrigger = vi.fn()
  const controller = new MissionController(f.db, f.store, { onScheduleTrigger })
  const task = f.store.transaction('test_create', () => {
    const task = controller.createTask(input())
    expect(onScheduleTrigger).not.toHaveBeenCalled()
    return task
  })
  expect(task.stage).toBe('READY')
  await Promise.resolve()
  expect(onScheduleTrigger).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
})
it('suppresses scheduling and Task creation when the containing transaction rolls back', async () => {
  const onScheduleTrigger = vi.fn()
  const controller = new MissionController(f.db, f.store, { onScheduleTrigger })
  expect(() =>
    f.store.transaction('test_rollback', () => {
      controller.createTask(input())
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  await Promise.resolve()
  expect(f.store.listTaskStages({ missionId: f.missionId })).toHaveLength(12)
  expect(onScheduleTrigger).not.toHaveBeenCalled()
})
it('requires an executable Mission and its active approved plan', () => {
  f.controller.pauseMission(f.missionId)
  expect(() => f.controller.createTask(input())).toThrow(
    expect.objectContaining({ code: 'mission_not_executing' })
  )
  f.controller.resumeMission(f.missionId)
  f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'SUPERSEDED' })
  expect(() => f.controller.createTask(input())).toThrow(
    expect.objectContaining({ code: 'plan_pending' })
  )
})
