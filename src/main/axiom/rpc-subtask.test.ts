import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture, subtask } from './execution/attempt-channel-fixture.test-support'
import { RunMailboxConsumer } from './mission-controller/run-mailbox-consumer'
import { provenance } from '../../shared/axiom-contract/contract-fixtures.test-support'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
async function request(auto: boolean) {
  const worker = f.bind('T04')
  const policy = f.store.getPolicy(f.mission.id)!
  f.store.upsertPolicy(f.mission.id, { ...policy, approvalRules: { subtaskAutoCreate: auto } })
  expect(
    await f.call(
      'axiom.attempt.request-subtask',
      {
        from: worker.from,
        attemptId: worker.attemptId,
        summary: 'Split migration',
        subtask: { ...subtask, allowedPaths: ['src/storage/migrate.ts'] }
      },
      { orchestrationCapability: worker.capability }
    )
  ).toMatchObject({ ok: true })
  const message = f.db.getUnreadRunMailbox(f.mission.runId)[0]!
  new RunMailboxConsumer(f.runtime, f.store, f.missions, {
    missionId: f.mission.id,
    runId: f.mission.runId,
    consumerGeneration: 1
  }).handle([message])
  return { message, worker }
}
it.each([false, true])('auto-create policy %s', async (auto) => {
  const { message, worker } = await request(auto)
  const rows = f.store.listTaskStages({ missionId: f.mission.id })
  expect(rows).toHaveLength(auto ? 13 : 12)
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toHaveLength(
    auto ? 0 : 1
  )
  if (auto) {
    const created = rows.find((t) => t.spec.title === subtask.title)!
    expect(created.stage).toBe('DEFINED')
    expect(f.store.listUpstreamEdges(created.taskId)).toMatchObject([{ fromTaskId: worker.taskId }])
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'subtask.resolved',
          objectId: message.id,
          after: expect.objectContaining({ decision: 'auto_accept', taskId: created.taskId })
        }),
        expect.objectContaining({
          event: 'plan.minor_adjustment',
          after: expect.objectContaining({
            classification: 'MINOR_ADJUSTMENT',
            origin: 'request_subtask'
          })
        })
      ])
    )
  }
})
it.each(['accept', 'reject'] as const)('resolves pending request by %s once', async (decision) => {
  const { message, worker } = await request(false)
  const p = { missionId: f.mission.id, messageId: message.id, decision, rationale: 'Reviewed' }
  expect(await f.call('axiom.message.resolve', p)).toMatchObject({ ok: true })
  expect(f.store.listTaskStages({ missionId: f.mission.id })).toHaveLength(
    decision === 'accept' ? 13 : 12
  )
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toEqual([])
  const created = f.store
    .listTaskStages({ missionId: f.mission.id })
    .find((t) => t.spec.title === subtask.title)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        event: 'subtask.resolved',
        objectId: message.id,
        after: { decision, reason: 'Reviewed', ...(created ? { taskId: created.taskId } : {}) }
      })
    ])
  )
  if (decision === 'accept') {
    expect(created).toBeDefined()
    expect(f.store.listUpstreamEdges(created!.taskId)).toMatchObject([
      { fromTaskId: worker.taskId }
    ])
  }

  expect(await f.call('axiom.message.resolve', p)).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument' }
  })
})
it('rechecks the requesting Attempt at human acceptance', async () => {
  const { message, worker } = await request(false)
  f.db.settleWorkerReport({
    taskId: worker.taskId,
    dispatchId: worker.attemptId,
    outcome: 'succeeded',
    result: 'done'
  })
  expect(
    await f.call('axiom.message.resolve', {
      missionId: f.mission.id,
      messageId: message.id,
      decision: 'accept',
      rationale: 'Reviewed'
    })
  ).toMatchObject({ ok: false, error: { code: 'invalid_argument' } })
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toHaveLength(1)
})
it('creates a root Task through the public RPC with provenance and readiness', async () => {
  f.missions.startExecution(f.mission.id)
  const result = await f.call('axiom.task.create', {
    missionId: f.mission.id,
    task: {
      ...subtask,
      allowedPaths: undefined,
      scope: { allowedPaths: ['extra.ts'] },
      kind: 'task',
      retryPolicy: { maxAttempts: 2 }
    },
    dependsOn: [],
    provenance
  })
  expect(result).toMatchObject({
    ok: true,
    result: { task: { title: subtask.title, stage: 'READY' } }
  })
})
