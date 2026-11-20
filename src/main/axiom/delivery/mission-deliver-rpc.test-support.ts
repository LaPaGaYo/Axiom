import { expect, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { rpcFixture } from '../rpc-fixture.test-support'
import {
  finalizationFixture,
  integrationHead
} from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { latestDeliveryApproval } from '../approval/delivery-approval'
import { decided } from '../approval/delivery-decision-rpc.test-support'
import * as branches from '../execution/integration-base'

export {
  decided,
  refused,
  pending,
  responseExample
} from '../approval/delivery-decision-rpc.test-support'
export { integrationHead, targetHead } from '../finalization/finalization-fixture.test-support'

export async function deliveryFixture(options: { grant?: boolean; upToDate?: boolean } = {}) {
  const rpc = rpcFixture()
  expect(rpc.db).toBeInstanceOf(OrchestrationDb)
  const f = finalizationFixture(rpc.db)
  f.missions.startFinalization(f.missionId)
  const reads = mockFinalizationGit(rpc.runtime)
  if (options.upToDate) {
    reads.readGit.mockImplementation(async (_cwd, args) =>
      args[0] === 'rev-parse' ? `${integrationHead}\n` : ''
    )
  }
  await executeFinalization({ ...f, runtime: rpc.runtime }, f.missionId)
  const approval = latestDeliveryApproval(f.store, f.missionId)
  if (!approval) {
    throw new Error('Missing waiting approval')
  }
  const move = vi
    .spyOn(branches, 'advanceLocalBranch')
    .mockResolvedValue({ advanced: true, written: true })
  if (options.grant !== false) {
    decided(await rpc.call('axiom.approval.grant', { approvalId: approval.id }))
  }
  const input = { missionId: f.missionId, approvalId: approval.id }
  return { ...f, rpc, approval, ...reads, move, input }
}

export function deliveryEvents(f: Awaited<ReturnType<typeof deliveryFixture>>, event?: string) {
  return f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((entry) => !event || entry.event === event)
}

export function eventExample(label: string, event: unknown) {
  if (process.env.AXIOM_DELIVERY_RESPONSE_LOG === '1') {
    console.info(label, JSON.stringify(event))
  }
}
