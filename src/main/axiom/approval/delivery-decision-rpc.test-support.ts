import { expect } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { rpcFixture } from '../rpc-fixture.test-support'
import { finalizationFixture } from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { latestDeliveryApproval } from './delivery-approval'
import { MissionResponseSchema } from '../../../shared/axiom-contract/mission-params'
import { MissionPendingResponseSchema } from '../../../shared/axiom-contract/mission-pending'

export async function waitingDeliveryFixture() {
  const rpc = rpcFixture()
  expect(rpc.db).toBeInstanceOf(OrchestrationDb)
  const f = finalizationFixture(rpc.db)
  f.missions.startFinalization(f.missionId)
  mockFinalizationGit(rpc.runtime)
  await executeFinalization({ ...f, runtime: rpc.runtime }, f.missionId)
  const approval = latestDeliveryApproval(f.store, f.missionId)
  if (!approval) {
    throw new Error('Missing waiting approval')
  }
  return { ...f, rpc, approval }
}

type Response = Awaited<ReturnType<ReturnType<typeof rpcFixture>['call']>>

export function decided(response: Response) {
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return MissionResponseSchema.parse(response.result)
}

export function refused(response: Response, code: string) {
  expect(response.ok).toBe(false)
  if (response.ok) {
    throw new Error('Unexpected success')
  }
  expect(response.error.code).toBe(code)
  return response.error
}

export async function pending(f: Awaited<ReturnType<typeof waitingDeliveryFixture>>) {
  const response = await f.rpc.call('axiom.mission.pending', { missionId: f.missionId })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return MissionPendingResponseSchema.parse(response.result).items
}

export function responseExample(label: string, response: Response) {
  if (process.env.AXIOM_DELIVERY_RESPONSE_LOG === '1') {
    console.info(label, JSON.stringify(response))
  }
}
