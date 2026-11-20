import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { MissionController } from './mission-controller'
import { deliveryFixture, deliveryEvents } from '../delivery/mission-deliver-rpc.test-support'
import {
  goal,
  provenance,
  makeProposal
} from '../../../shared/axiom-contract/contract-fixtures.test-support'

let f: Awaited<ReturnType<typeof deliveryFixture>>
beforeEach(async () => {
  f = await deliveryFixture()
  expect(f.db).toBeInstanceOf(OrchestrationDb)
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it('a Mission that awaits approval completes with the reason delivered and releases its target branch', () => {
  const now = '2040-01-01T00:00:00.000Z'
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2099-01-01' })
  const missions = new MissionController(f.db, f.store, { now: () => now })
  const other = missions.createMission({
    repoId: 'repo',
    repoPath: '/repository',
    targetBranch: 'main',
    goal,
    provenance
  })
  const plan = missions.proposePlan({
    missionId: other.mission.id,
    provenance,
    planRevision: { ...makeProposal(), goalRevisionId: other.goalRevision.id }
  })
  missions.approvePlan({ planRevisionId: plan.id, resolver: 'user', provenance })
  expect(() => missions.assertStartable(other.mission.id)).toThrow('mission_target_busy')
  expect(missions).toHaveProperty('checkDelivery')
  missions.checkDelivery(f.input)
  const result = missions.settleDelivery({
    ...f.input,
    via: 'desktop',
    kind: 'completed',
    outcome: 'fast_forwarded'
  })
  expect(result.mission.status).toBe('COMPLETED')
  expect(result.approval).toMatchObject({
    status: 'CONSUMED',
    outcome: 'fast_forwarded',
    executedAt: now,
    updatedAt: now
  })
  expect(deliveryEvents(f, 'mission.status').at(-1)).toMatchObject({
    createdAt: now,
    after: { reason: 'delivered' }
  })
  expect(deliveryEvents(f, 'approval.consumed')[0].createdAt).toBe(now)
  expect(missions.assertStartable(other.mission.id).id).toBe(other.mission.id)
})

it('a Mission that awaits approval returns to FINALIZING with a reason and a Mission in another status does not', () => {
  const onScheduleTrigger = vi.fn()
  const missions = new MissionController(f.db, f.store, { onScheduleTrigger })
  expect(missions).toHaveProperty('settleDelivery')
  missions.pauseMission(f.missionId)
  const before = deliveryEvents(f)
  const input = {
    ...f.input,
    via: 'desktop',
    kind: 'inputs_changed' as const,
    reason: 'target_branch_moved' as const
  }
  expect(() => missions.settleDelivery(input)).toThrow('illegal_transition')
  expect(deliveryEvents(f)).toEqual(before)
  missions.resumeMission(f.missionId)
  onScheduleTrigger.mockClear()
  expect(() => missions.settleDelivery(input)).toThrow('delivery_inputs_changed')
  expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
  expect(deliveryEvents(f, 'mission.status').at(-1)?.after).toMatchObject({
    reason: 'target_branch_moved'
  })
  expect(onScheduleTrigger).toHaveBeenCalledWith(f.missionId, 'stage_change')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
})
