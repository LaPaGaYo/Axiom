import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createParams, rpcFixture } from './rpc-fixture.test-support'
import { MissionCreateResponseSchema } from '../../shared/axiom-contract/mission-params'
import {
  AttemptListResponseSchema,
  AttemptResponseSchema
} from '../../shared/axiom-contract/attempt-params'
import * as workerObservation from '../runtime/rpc/methods/orchestration/worker/worker-observation'
let f: ReturnType<typeof rpcFixture>
beforeEach(() => {
  f = rpcFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
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
    {
      attemptId: null,
      role: 'worker',
      state: 'LAUNCH_PENDING',
      liveness: null,
      livenessReason: null,
      workspace: null
    }
  ])
  expect(
    await f.call('axiom.attempt.list', { missionId: mission.id, taskId: 'other' })
  ).toMatchObject({ ok: true, result: { attempts: [] } })
  expect(await f.call('axiom.attempt.show', { attemptId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'attempt_not_found' }
  })
})

it('awaits execution-host inspection for bound attempts in both read methods', async () => {
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
    dispatchId: 'd1',
    agentSpecId: 'spec',
    contextPackageId: 'context'
  })
  const inspect = vi.spyOn(workerObservation, 'inspectWorkerTerminal').mockResolvedValue({
    status: 'live',
    exact: true,
    terminal: null
  })
  const shown = await f.call('axiom.attempt.show', { attemptId: 'd1' })
  if (!shown.ok) {
    throw new Error(shown.error.code)
  }
  expect(AttemptResponseSchema.parse(shown.result).attempt).toMatchObject({
    attemptId: 'd1',
    liveness: 'live',
    livenessReason: null
  })
  expect(inspect).toHaveBeenCalledExactlyOnceWith(f.runtime, f.db, 'd1')
  inspect.mockResolvedValue({
    status: 'unverifiable',
    reason: 'missing_liveness_verdict',
    exact: true,
    terminal: null
  })
  const listed = await f.call('axiom.attempt.list', { missionId: mission.id })
  if (!listed.ok) {
    throw new Error(listed.error.code)
  }
  expect(AttemptListResponseSchema.parse(listed.result).attempts).toMatchObject([
    { attemptId: 'd1', liveness: 'unverifiable', livenessReason: 'missing_liveness_verdict' }
  ])
  expect(inspect).toHaveBeenCalledTimes(2)
})
