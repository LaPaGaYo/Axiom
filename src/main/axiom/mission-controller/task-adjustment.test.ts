import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planned } from './controller-fixture.test-support'
import { MissionController } from './mission-controller'

let f: ReturnType<typeof planned>
beforeEach(() => {
  f = planned()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const rationale = 'Reviewed the failing check; expand the authorized scope.'
function task() {
  return f.store.listTaskStages({ missionId: f.missionId })[0]!
}
function pending(taskId: string, reason = 'blocked_by_scope') {
  const mission = f.store.getMission(f.missionId)!
  return f.db.insertMessage({
    from: 'worker',
    to: `run:${mission.runId}`,
    runId: mission.runId,
    subject: 'Blocked',
    type: 'escalation',
    payload: JSON.stringify({
      axiom: {
        version: 1,
        type: 'BLOCKED',
        missionId: f.missionId,
        taskId,
        attemptId: 'attempt-1',
        summary: 'Blocked',
        artifactIds: [],
        related: {},
        blocked: { reason, paths: ['check.ts'] }
      }
    })
  })
}
function blocked(attemptCount = 1, reason = 'scope') {
  const current = task()
  f.store.updateTaskStage({
    taskId: current.taskId,
    from: 'DEFINED',
    to: 'NEEDS_FIX',
    attemptCountDelta: attemptCount
  })
  f.controller.transitionTaskStage({ taskId: current.taskId, to: 'BLOCKED', reason, actor: 'test' })
  const message = pending(current.taskId)
  f.store.insertAttemptBinding({
    taskId: current.taskId,
    missionId: f.missionId,
    seq: attemptCount,
    dispatchId: null,
    branch: `axiom/attempt/${current.taskId}/${attemptCount}`,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  return { ...current, message }
}
const adjust = (taskId: string, extra = {}) =>
  f.controller.adjustTask({ taskId, rationale, actor: 'user', ...extra })
const snapshot = () =>
  ['task_stages', 'audit_events'].map((table) =>
    f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  )

it('widens scope in order, resolves every pending BLOCKED message and restores NEEDS_FIX then READY', () => {
  const current = blocked()
  const another = pending(current.taskId, 'cannot_reproduce')
  const paths = current.spec.scope.allowedPaths
  const result = adjust(current.taskId, { addAllowedPaths: [paths[0], 'check.ts', 'check.ts'] })
  expect(result).toMatchObject({
    stage: 'READY',
    previousStage: null,
    spec: { scope: { allowedPaths: [...paths, 'check.ts'] } },
    retryPolicy: { maxAttempts: 2 }
  })
  const audits = f.store.listAuditEvents({ missionId: f.missionId })
  expect(audits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'task.adjusted',
        objectId: current.taskId,
        before: { allowedPaths: paths, maxAttempts: 2 },
        after: {
          allowedPaths: [...paths, 'check.ts'],
          maxAttempts: 2,
          addedPaths: ['check.ts'],
          rationale,
          afterAttemptSeq: 1,
          origin: 'user',
          resolvedMessageIds: [current.message.id, another.id]
        }
      }),
      expect.objectContaining({
        event: 'plan.minor_adjustment',
        objectId: f.planId,
        after: {
          classification: 'MINOR_ADJUSTMENT',
          origin: 'task_adjust',
          taskId: current.taskId,
          addedPaths: ['check.ts'],
          maxAttempts: 2,
          rationale
        }
      })
    ])
  )
  expect(audits.filter((a) => a.event === 'blocked.resolved')).toMatchObject([
    {
      objectKind: 'message',
      objectId: current.message.id,
      after: { decision: 'adjusted', taskId: current.taskId, rationale }
    },
    {
      objectKind: 'message',
      objectId: another.id,
      after: { decision: 'adjusted', taskId: current.taskId, rationale }
    }
  ])
  expect(audits.filter((a) => a.event === 'task.stage').slice(-2)).toMatchObject([
    { before: { stage: 'BLOCKED' }, after: { stage: 'NEEDS_FIX', reason: 'adjusted' } },
    { before: { stage: 'NEEDS_FIX' }, after: { stage: 'READY', reason: 'adjusted' } }
  ])
  expect(f.store.listMessages({ missionId: f.missionId, pendingOnly: true })).toEqual([])
})
it('rolls back spec, stage, audits and pending resolutions on retry exhaustion; a budget increase reopens it', () => {
  const current = blocked(2)
  const before = snapshot()
  expect(() => adjust(current.taskId, { addAllowedPaths: ['check.ts'] })).toThrow(
    expect.objectContaining({
      code: 'retry_budget_exhausted',
      data: { taskId: current.taskId, attemptCount: 2, maxAttempts: 2 }
    })
  )
  expect(snapshot()).toEqual(before)
  expect(f.store.listMessages({ missionId: f.missionId, pendingOnly: true })).toHaveLength(1)
  expect(adjust(current.taskId, { addAllowedPaths: ['check.ts'], maxAttempts: 3 })).toMatchObject({
    stage: 'READY',
    retryPolicy: { maxAttempts: 3 },
    spec: { retryPolicy: { maxAttempts: 3 } }
  })
})
it('allows a rationale-only candidate dispute resolution without changing scope', () => {
  const current = blocked(1, 'candidate_disputed')
  expect(adjust(current.taskId)).toMatchObject({ stage: 'READY', spec: current.spec })
})
it.each(['DEFINED', 'READY', 'NEEDS_FIX'] as const)('adjusts an idle %s Task', (stage) => {
  const current = task()
  if (stage !== 'DEFINED') {
    f.store.updateTaskStage({ taskId: current.taskId, from: 'DEFINED', to: stage })
  }
  expect(adjust(current.taskId, { addAllowedPaths: ['check.ts'] }).stage).toBe(
    stage === 'NEEDS_FIX' ? 'READY' : stage
  )
})
it('rejects RUNNING Tasks and retry ceilings below consumed Attempts without writes', () => {
  const current = blocked(2)
  let before = snapshot()
  expect(() => adjust(current.taskId, { maxAttempts: 1 })).toThrow(
    expect.objectContaining({ code: 'invalid_argument' })
  )
  expect(snapshot()).toEqual(before)
  f.store.updateTaskStage({ taskId: current.taskId, from: 'BLOCKED', to: 'RUNNING' })
  before = snapshot()
  expect(() => adjust(current.taskId)).toThrow(
    expect.objectContaining({
      code: 'illegal_transition',
      data: { taskId: current.taskId, from: 'RUNNING', reason: 'task_not_adjustable' }
    })
  )
  expect(snapshot()).toEqual(before)
})
it('refuses paused Missions and Tasks outside the active approved plan', () => {
  const current = task()
  f.controller.pauseMission(f.missionId)
  expect(() => adjust(current.taskId)).toThrow(
    expect.objectContaining({ code: 'mission_not_executing' })
  )
  f.controller.resumeMission(f.missionId)
  f.store.setActiveRevisions({ id: f.missionId, activePlanRevisionId: null })
  expect(() => adjust(current.taskId)).toThrow(expect.objectContaining({ code: 'plan_pending' }))
})
it('cancellation resolves typed BLOCKED messages without touching another Task', () => {
  const current = blocked()
  const other = f.store.listTaskStages({ missionId: f.missionId })[1]!
  const otherMessage = pending(other.taskId)
  expect(f.controller.cancelTask({ taskId: current.taskId, rationale, actor: 'user' }).stage).toBe(
    'CANCELED'
  )
  expect(f.store.listMessages({ missionId: f.missionId, pendingOnly: true })).toMatchObject([
    { id: otherMessage.id }
  ])
  expect(
    f.store.listAuditEvents({ missionId: f.missionId }).find((a) => a.event === 'blocked.resolved')
  ).toMatchObject({
    objectKind: 'message',
    objectId: current.message.id,
    after: { decision: 'canceled', taskId: current.taskId, rationale }
  })
})
it('schedules after commit and suppresses scheduling for an outer rollback', async () => {
  const current = blocked()
  const onScheduleTrigger = vi.fn()
  const controller = new MissionController(f.db, f.store, { onScheduleTrigger })
  expect(() =>
    f.store.transaction('adjust_rollback', () => {
      controller.adjustTask({ taskId: current.taskId, rationale, actor: 'user' })
      expect(onScheduleTrigger).not.toHaveBeenCalled()
      throw new Error('rollback')
    })
  ).toThrow('rollback')
  await Promise.resolve()
  expect(onScheduleTrigger).not.toHaveBeenCalled()
  controller.adjustTask({ taskId: current.taskId, rationale, actor: 'user' })
  expect(onScheduleTrigger).toHaveBeenCalledExactlyOnceWith(f.missionId, 'stage_change')
})
