import { afterEach, expect, it } from 'vitest'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { MissionCreateResponseSchema } from '../../shared/axiom-contract/mission-params'
import { AttemptListResponseSchema } from '../../shared/axiom-contract/attempt-params'
const f = rpcFixture()
afterEach(() => f.db.close())
it('lists pending bindings without launches and returns attempt_not_found for unknown dispatches', async () => {
  const created = await f.call('axiom.mission.create', createParams)
  if (!created.ok) {
    throw new Error(created.error.code)
  }
  const { mission } = MissionCreateResponseSchema.parse(created.result)
  f.store.insertAttemptBinding({
    missionId: mission.id,
    taskId: 't1',
    seq: 1,
    branch: 'axiom/attempt/t1/1',
    dispatchId: null,
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  const result = await f.call(
    'axiom.attempt.list',
    { missionId: mission.id },
    { orchestrationContractVersion: undefined }
  )
  expect(result.ok).toBe(true)
  if (!result.ok) {
    throw new Error(result.error.code)
  }
  expect(AttemptListResponseSchema.parse(result.result).attempts).toMatchObject([
    { attemptId: null, state: 'LAUNCH_PENDING', liveness: null, workspace: null }
  ])
  expect(
    await f.call('axiom.attempt.list', { missionId: mission.id, taskId: 'other' })
  ).toMatchObject({ ok: true, result: { attempts: [] } })
  expect(await f.call('axiom.attempt.show', { attemptId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'attempt_not_found' }
  })
})
