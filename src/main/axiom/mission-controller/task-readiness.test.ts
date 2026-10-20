import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeProposal } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  TASK_STAGES,
  TASK_STAGE_TRANSITIONS,
  type TaskStage
} from '../../../shared/axiom-contract/lifecycle'
import type { PlanProposal } from '../../../shared/axiom-contract/plan-proposal'
import { actor, fixture, planned } from './controller-fixture.test-support'

let f: ReturnType<typeof planned>
beforeEach(() => {
  f = planned(fixture())
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})

function task(id: string) {
  const row = f.controller.listTasks({ missionId: f.missionId }).find((t) => t.spec.id === id)
  if (!row) {
    throw new Error(`Missing fixture task ${id}`)
  }
  return row
}
function seedStage(
  id: string,
  stage: TaskStage,
  previousStage: TaskStage | null = null,
  attemptCountDelta = 0
) {
  const row = task(id)
  f.store.updateTaskStage({
    taskId: row.taskId,
    from: row.stage,
    to: stage,
    previousStage,
    attemptCountDelta
  })
}

describe('database-derived readiness', () => {
  it('moves roots in Orca id order, is idempotent, and never demotes READY', () => {
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
    f.controller.startExecution(f.missionId)
    const ready = f.controller.listTasks({ missionId: f.missionId, stage: 'READY' })
    expect(ready.map((t) => t.spec.id).sort()).toEqual(['T01', 'T02', 'T03'])
    expect(ready.map((t) => t.taskId)).toEqual(ready.map((t) => t.taskId).sort())
    const events = f.store.listAuditEvents({ missionId: f.missionId })
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
    expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(events)
    f.controller.pauseMission(f.missionId)
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
    expect(f.controller.listTasks({ missionId: f.missionId, stage: 'READY' })).toEqual(ready)
  })

  it.each(TASK_STAGES)('honors default and relaxed edges with upstream %s', (stage) => {
    f.db.close()
    const source = makeProposal()
    const proposal: PlanProposal = {
      ...source,
      tasks: source.tasks.slice(0, 3),
      edges: [
        { fromTaskId: 'T01', toTaskId: 'T02', readinessThreshold: 'VERIFIED' },
        { fromTaskId: 'T01', toTaskId: 'T03', readinessThreshold: 'INTEGRATED' }
      ]
    }
    f = planned(fixture(), proposal)
    f.controller.startExecution(f.missionId)
    seedStage('T01', stage)
    const moved = f.controller.recomputeReadiness(f.missionId)
    expect(task('T02').stage).toBe(
      ['VERIFIED', 'INTEGRATION_READY', 'INTEGRATED'].includes(stage) ? 'READY' : 'DEFINED'
    )
    expect(task('T03').stage).toBe(stage === 'INTEGRATED' ? 'READY' : 'DEFINED')
    expect(moved).toEqual([...moved].sort())
  })

  it('enforces task attempt limits and the Mission-wide sum, including non-DEFINED Tasks', () => {
    seedStage('T01', 'DEFINED', null, 2)
    f.controller.startExecution(f.missionId)
    expect(task('T01').stage).toBe('DEFINED')
    seedStage('T02', 'RUNNING', null, 1)
    seedStage('T03', 'DEFINED')
    const policy = f.store.getPolicy(f.missionId)
    if (!policy) {
      throw new Error('Missing policy')
    }
    f.store.upsertPolicy(f.missionId, { ...policy, budget: { maxAttempts: 3 } })
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
    expect(task('T03').stage).toBe('DEFINED')
    f.store.upsertPolicy(f.missionId, { ...policy, budget: { maxAttempts: 4 } })
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([task('T03').taskId])
  })

  it('requires the task PlanRevision to remain APPROVED', () => {
    f.controller.startExecution(f.missionId)
    seedStage('T01', 'DEFINED')
    f.store.updatePlanRevisionStatus({ id: f.planId, from: 'APPROVED', to: 'SUPERSEDED' })
    expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
    expect(task('T01').stage).toBe('DEFINED')
  })

  it('does not bypass readiness through generic DEFINED to READY', () => {
    const root = task('T01')
    expect(() =>
      f.controller.transitionTaskStage({
        taskId: root.taskId,
        to: 'READY',
        actor,
        reason: 'bypass'
      })
    ).toThrowError(expect.objectContaining({ code: 'mission_not_executing' }))
    f.controller.startExecution(f.missionId)
    expect(() =>
      f.controller.transitionTaskStage({
        taskId: task('T04').taskId,
        to: 'READY',
        actor,
        reason: 'bypass'
      })
    ).toThrowError(expect.objectContaining({ code: 'illegal_transition' }))
    expect(task('T04').stage).toBe('DEFINED')
  })
})

describe('generic Task transitions', () => {
  it.each(TASK_STAGES)('checks every target from %s and preserves rows on illegality', (from) => {
    f.controller.startExecution(f.missionId)
    for (const to of TASK_STAGES) {
      const previousStage =
        from === 'BLOCKED' && to !== 'BLOCKED' && to !== 'INTEGRATED' && to !== 'CANCELED'
          ? to
          : from === 'BLOCKED'
            ? 'READY'
            : null
      seedStage('T01', from, previousStage)
      const before = task('T01')
      const events = f.store.listAuditEvents({ missionId: f.missionId })
      const action = () =>
        f.controller.transitionTaskStage({
          taskId: before.taskId,
          to,
          actor,
          reason: 'generic contract'
        })
      if (
        TASK_STAGE_TRANSITIONS[from].includes(to) &&
        to !== 'RUNNING' &&
        !(from === 'RUNNING' && to === 'SUBMITTED')
      ) {
        action()
        expect(task('T01')).toMatchObject({
          stage: to,
          previousStage: to === 'BLOCKED' ? from : null
        })
        expect(f.store.listAuditEvents({ missionId: f.missionId })).toHaveLength(events.length + 1)
      } else {
        expect(action).toThrowError(expect.objectContaining({ code: 'illegal_transition' }))
        expect(task('T01')).toEqual(before)
        expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(events)
      }
    }
  })

  it('permits BLOCKED only to its persisted previous stage or CANCELED', () => {
    seedStage('T01', 'BLOCKED', 'VERIFYING')
    const before = task('T01')
    expect(() =>
      f.controller.transitionTaskStage({
        taskId: before.taskId,
        to: 'RUNNING',
        actor,
        reason: 'wrong target'
      })
    ).toThrowError(expect.objectContaining({ code: 'illegal_transition' }))
    expect(task('T01')).toEqual(before)
    f.controller.transitionTaskStage({
      taskId: before.taskId,
      to: 'VERIFYING',
      actor,
      reason: 'resolved'
    })
    expect(task('T01')).toMatchObject({ stage: 'VERIFYING', previousStage: null })
  })

  it('reports a store CAS miss as stale and records no audit', () => {
    const before = task('T01')
    const events = f.store.listAuditEvents({ missionId: f.missionId })
    vi.spyOn(f.store, 'updateTaskStage').mockReturnValueOnce(false)
    expect(() =>
      f.controller.cancelTask({ taskId: before.taskId, actor, rationale: 'cancel' })
    ).toThrowError(expect.objectContaining({ code: 'stale_state' }))
    expect(task('T01')).toEqual(before)
    expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(events)
  })
})
