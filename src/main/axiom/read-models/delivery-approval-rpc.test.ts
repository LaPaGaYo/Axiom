import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { rpcFixture } from '../rpc-fixture.test-support'
import {
  finalizationFixture,
  integrationHead,
  targetHead
} from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { MissionResponseSchema } from '../../../shared/axiom-contract/mission-params'
import { MissionPendingResponseSchema } from '../../../shared/axiom-contract/mission-pending'
import { latestDeliveryApproval, requestDeliveryApproval } from '../approval/delivery-approval'
import { sha256 } from '../artifacts/artifact-store'
import { utcTimestamp } from './waiting-context'

let rpc: ReturnType<typeof rpcFixture>
let f: ReturnType<typeof finalizationFixture>
beforeEach(async () => {
  rpc = rpcFixture()
  expect(rpc.db).toBeInstanceOf(OrchestrationDb)
  f = finalizationFixture(rpc.db)
  f.missions.startFinalization(f.missionId)
  mockFinalizationGit(rpc.runtime)
  await executeFinalization({ ...f, runtime: rpc.runtime }, f.missionId)
})
afterEach(() => {
  rpc.db.close()
  vi.restoreAllMocks()
})
async function result(method: string) {
  const response = await rpc.call(method, { missionId: f.missionId })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return response.result
}
const show = async () => MissionResponseSchema.parse(await result('axiom.mission.show'))
const pending = async () =>
  MissionPendingResponseSchema.parse(await result('axiom.mission.pending'))

it('mission.show carries the delivery approval of a Mission that awaits approval', async () => {
  const ready = await show()
  expect(ready.mission.status).toBe('READY_FOR_APPROVAL')
  expect(ready.approval?.status).toBe('PENDING')
  expect(ready.approval).toEqual(latestDeliveryApproval(f.store, f.missionId))
  expect(ready.finalization?.outcome).toBe('ready')
  if (ready.finalization?.outcome !== 'ready') {
    throw new Error('Missing ready record')
  }
  expect(ready.approval?.inputsHash).toBe(ready.finalization.reportSha256)
})

it('mission.pending lists a waiting delivery approval as a blocking mission item that only offers cancel', async () => {
  const item = (await pending()).items.find((entry) => entry.reason === 'delivery_approval_pending')
  expect(item).toMatchObject({
    id: `mission:${f.missionId}`,
    kind: 'mission',
    objectId: f.missionId,
    reason: 'delivery_approval_pending',
    blocking: true,
    actions: ['axiom.mission.cancel']
  })
  const approval = latestDeliveryApproval(f.store, f.missionId)
  expect(approval?.status).toBe('PENDING')
  if (!approval) {
    throw new Error('Missing approval')
  }
  expect(item?.since).toBe(utcTimestamp(approval.createdAt))
  const ready = (await show()).finalization
  expect(ready?.outcome).toBe('ready')
  if (ready?.outcome !== 'ready') {
    throw new Error('Missing ready record')
  }
  for (const text of [
    'main',
    integrationHead.slice(0, 7),
    targetHead.slice(0, 7),
    ready.reportArtifactId,
    approval.expiresAt
  ]) {
    expect(item?.summary).toContain(text)
  }
})

it('mission.pending lists no delivery approval item when the approval was made with another report hash', async () => {
  const approval = f.store.transaction('test_superseded', () =>
    requestDeliveryApproval(
      f.store,
      f.missionId,
      sha256('another completion report'),
      '2026-11-19T12:00:00.000Z'
    )
  )
  expect(approval.status).toBe('PENDING')
  const ready = (await show()).finalization
  expect(ready?.outcome).toBe('ready')
  if (ready?.outcome !== 'ready') {
    throw new Error('Missing ready record')
  }
  expect(approval.inputsHash).not.toBe(ready.reportSha256)
  expect(
    (await pending()).items.find((item) => item.reason === 'delivery_approval_pending')
  ).toBeUndefined()
})
