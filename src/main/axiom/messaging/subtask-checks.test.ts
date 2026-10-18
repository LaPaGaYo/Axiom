import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture, subtask } from '../execution/attempt-channel-fixture.test-support'
import { checkSubtask, type Check } from './subtask-checks'
import type { TaskSpec } from '../../../shared/axiom-contract/mission-objects'
import { RunMailboxConsumer } from '../mission-controller/run-mailbox-consumer'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const checks: Check[] = ['scope', 'depth', 'duplicate', 'dependency', 'budget', 'attempt']

it.each(checks)(
  '%s fails deterministically and keeps an auto-create request pending',
  async (check) => {
    const worker = f.bind('T04')
    const policy = f.store.getPolicy(f.mission.id)!
    f.store.upsertPolicy(f.mission.id, {
      ...policy,
      approvalRules: { subtaskAutoCreate: true },
      ...(check === 'budget' ? { budget: { maxAttempts: 2 } } : {})
    })
    const requested = {
      ...subtask,
      allowedPaths: [check === 'scope' ? 'src/storage-other/x.ts' : 'src/storage/migrate.ts'],
      ...(check === 'duplicate' ? { title: '  STORAGE MIGRATION  ' } : {}),
      ...(check === 'dependency' ? { dependsOn: ['foreign-task'] } : {})
    }
    expect(
      await f.call(
        'axiom.attempt.request-subtask',
        {
          from: worker.from,
          attemptId: worker.attemptId,
          summary: 'D50 matrix',
          subtask: requested
        },
        { orchestrationCapability: worker.capability }
      )
    ).toMatchObject({ ok: true })
    const message = f.db.getUnreadRunMailbox(f.mission.runId)[0]!
    if (check === 'depth') {
      f.store.appendAuditEvent({
        missionId: f.mission.id,
        actor: 'MissionController',
        objectKind: 'task',
        objectId: worker.taskId,
        event: 'task.created',
        before: null,
        after: { origin: 'request_subtask' }
      })
    }
    if (check === 'attempt') {
      f.db.settleWorkerReport({
        taskId: worker.taskId,
        dispatchId: worker.attemptId,
        outcome: 'succeeded',
        result: 'settled'
      })
    }
    const task: TaskSpec = {
      ...requested,
      id: 'new-task',
      scope: { allowedPaths: requested.allowedPaths },
      retryPolicy: { maxAttempts: 2 },
      kind: 'task'
    }
    const result = checkSubtask(f, {
      missionId: f.mission.id,
      task,
      dependsOn: [worker.taskId, ...(requested.dependsOn ?? [])],
      source: { taskId: worker.taskId, attemptId: worker.attemptId, messageId: message.id }
    })
    expect(result).toEqual({ ok: false, failed: [check] })
    new RunMailboxConsumer(f.runtime, f.store, f.missions, {
      missionId: f.mission.id,
      runId: f.mission.runId,
      consumerGeneration: 1
    }).handle([message])
    expect(f.store.listTaskStages({ missionId: f.mission.id })).toHaveLength(12)
    expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toHaveLength(1)
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'subtask.checks_failed',
          objectId: message.id,
          after: { failed: [check] }
        })
      ])
    )
  }
)

it.each([
  ['src/storage/../outside.ts', false],
  ['src\\storage\\..\\outside.ts', false],
  ['src/storage/./migration.ts', true],
  ['src\\storage\\migration.ts', true],
  ['src/storage/child/../migration.ts', true]
])('normalizes scope %s', (allowedPath, ok) => {
  const worker = f.bind('T04')
  const task: TaskSpec = {
    ...subtask,
    id: 'new-task',
    scope: { allowedPaths: [allowedPath] },
    retryPolicy: { maxAttempts: 2 },
    kind: 'task'
  }
  expect(
    checkSubtask(f, {
      missionId: f.mission.id,
      task,
      dependsOn: [worker.taskId],
      source: { taskId: worker.taskId, attemptId: worker.attemptId, messageId: 'msg' }
    }).ok
  ).toBe(ok)
})
it('rejects an identical normalized scope set with a distinct title', () => {
  const task: TaskSpec = {
    ...subtask,
    id: 'new-task',
    scope: { allowedPaths: ['src/storage/.', 'src/storage/'] },
    retryPolicy: { maxAttempts: 2 },
    kind: 'task'
  }
  expect(checkSubtask(f, { missionId: f.mission.id, task, dependsOn: [] })).toEqual({
    ok: false,
    failed: ['duplicate']
  })
})
it('detects cycles in the extended graph', () => {
  const edge = f.store.listTaskEdges(f.mission.id)[0]!
  f.store.insertTaskEdges(f.mission.id, f.plan.id, [
    { fromTaskId: edge.toTaskId, toTaskId: edge.fromTaskId, readinessThreshold: 'INTEGRATED' }
  ])
  const task: TaskSpec = {
    ...subtask,
    id: 'new-task',
    scope: { allowedPaths: ['new.ts'] },
    retryPolicy: { maxAttempts: 2 },
    kind: 'task'
  }
  expect(checkSubtask(f, { missionId: f.mission.id, task, dependsOn: [] })).toEqual({
    ok: false,
    failed: ['dependency']
  })
})
