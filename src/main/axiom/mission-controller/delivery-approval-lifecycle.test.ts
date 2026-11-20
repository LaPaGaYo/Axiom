import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { finalizationFixture } from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { latestDeliveryApproval } from '../approval/delivery-approval'

let f: ReturnType<typeof finalizationFixture>
beforeEach(async () => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  f.missions.startFinalization(f.missionId)
  const { runtime } = mockFinalizationGit()
  await executeFinalization({ ...f, runtime }, f.missionId)
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const approval = () => latestDeliveryApproval(f.store, f.missionId)

it('canceling a Mission that awaits approval revokes its delivery approval', () => {
  expect(approval()?.status).toBe('PENDING')
  f.missions.cancelMission(f.missionId, 'Canceled by user')
  expect(f.store.getMission(f.missionId)?.status).toBe('CANCELED')
  expect(approval()).toMatchObject({
    status: 'REVOKED',
    resolver: 'MissionController',
    resolution: 'mission_canceled'
  })
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((event) => event.event === 'approval.revoked')
  ).toHaveLength(1)
})

it('pausing and resuming a Mission that awaits approval keeps the approval PENDING', () => {
  const before = approval()
  expect(before?.status).toBe('PENDING')
  f.missions.pauseMission(f.missionId)
  expect(f.store.getMission(f.missionId)?.status).toBe('PAUSED')
  expect(approval()).toEqual(before)
  f.missions.resumeMission(f.missionId)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(approval()).toMatchObject({
    id: before?.id,
    status: 'PENDING',
    inputsHash: before?.inputsHash
  })
  expect(f.store.listApprovals({ missionId: f.missionId })).toHaveLength(1)
})
