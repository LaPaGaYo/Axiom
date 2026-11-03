import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { channelFixture } from '../../../../axiom/execution/attempt-channel-fixture.test-support'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
function blockedTask() {
  f.missions.transitionTaskStage({
    taskId: f.t01.taskId,
    to: 'NEEDS_FIX',
    reason: 'attempt_blocked',
    actor: 'test'
  })
  f.missions.transitionTaskStage({
    taskId: f.t01.taskId,
    to: 'BLOCKED',
    reason: 'scope',
    actor: 'test'
  })
  return { taskId: f.t01.taskId, rationale: 'Reviewed', addAllowedPaths: ['extra.ts'] }
}
it('adjusts through the desktop RPC and replays one durable mutation receipt', async () => {
  const params = blockedTask()
  const envelope = { orchestrationRequestId: 'task-adjust-once' }
  const first = await f.call('axiom.task.adjust', params, envelope)
  expect(first).toMatchObject({ ok: true, result: { task: { id: params.taskId, stage: 'READY' } } })
  const after = f.snapshot()
  expect(await f.call('axiom.task.adjust', params, envelope)).toMatchObject({
    ok: true,
    result: {
      task: { id: params.taskId, stage: 'READY' },
      mutation: { requestId: envelope.orchestrationRequestId, replayed: true }
    }
  })
  expect(f.snapshot()).toEqual(after)
  expect(
    f.store.listAuditEvents({ missionId: f.mission.id }).filter((a) => a.event === 'task.adjusted')
  ).toHaveLength(1)
})
it('rolls back adjustment if mutation receipt persistence fails', async () => {
  const params = blockedTask()
  const before = f.snapshot()
  f.db.db.exec(`CREATE TRIGGER reject_adjust_receipt BEFORE INSERT ON mutation_receipts
    BEGIN SELECT RAISE(ABORT, 'receipt failed'); END`)
  expect(await f.call('axiom.task.adjust', params)).toMatchObject({ ok: false })
  expect(f.snapshot()).toEqual(before)
})
it.each(['local-cli', 'paired-device'] as const)(
  'refuses %s callers before any adjustment',
  async (kind) => {
    const params = blockedTask()
    const before = f.snapshot()
    const response = await f.dispatcher.dispatch(
      {
        id: 'adjust',
        authToken: 'test-caller',
        method: 'axiom.task.adjust',
        params,
        orchestrationContractVersion: 1,
        orchestrationRequestId: 'non-desktop-adjust'
      },
      { caller: kind === 'local-cli' ? { kind } : { kind, deviceId: 'paired-device' } }
    )
    expect(response).toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
    expect(f.snapshot()).toEqual(before)
  }
)
