import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { finalizationFixture } from '../finalization/finalization-fixture.test-support'
import { mockFinalizationGit } from '../finalization/finalization-runtime.test-support'
import { executeFinalization } from '../finalization/mission-finalize'
import { latestDeliveryApproval } from '../approval/delivery-approval'
import { MissionController } from './mission-controller'

let f: ReturnType<typeof finalizationFixture>
let missions: MissionController
let now: string
beforeEach(async () => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  f.missions.startFinalization(f.missionId)
  const { runtime } = mockFinalizationGit()
  await executeFinalization({ ...f, runtime }, f.missionId)
  now = '2099-01-01T00:00:00.000Z'
  missions = new MissionController(f.db, f.store, { now: () => now })
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
function approval() {
  const row = latestDeliveryApproval(f.store, f.missionId)
  if (!row) {
    throw new Error('Missing waiting approval')
  }
  return row
}
const events = () =>
  f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((event) => event.event === 'approval.clock_resumed')
const advance = (milliseconds: number) => {
  now = new Date(Date.parse(now) + milliseconds).toISOString()
}

it('resuming a paused Mission moves the expiry of its waiting approval forward by the time of the pause', () => {
  const before = approval()
  missions.pauseMission(f.missionId)
  advance(90_000)
  missions.resumeMission(f.missionId)
  const expiresAt = new Date(Date.parse(before.expiresAt) + 90_000).toISOString()
  expect(approval().expiresAt).toBe(expiresAt)
  expect(approval()).toMatchObject({
    id: before.id,
    status: 'PENDING',
    inputsHash: before.inputsHash
  })
  expect(events()).toHaveLength(1)
  expect(events()[0]).toMatchObject({
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: before.id,
    before: { expiresAt: before.expiresAt },
    after: { id: before.id, expiresAt, pausedMs: 90_000 },
    createdAt: now
  })
})

it('a block inside a pause moves the expiry only by the time spent in PAUSED', () => {
  const before = approval()
  missions.pauseMission(f.missionId)
  advance(90_000)
  missions.blockMission(f.missionId, 'Waiting on a resource')
  expect(approval().expiresAt).toBe(new Date(Date.parse(before.expiresAt) + 90_000).toISOString())
  advance(600_000)
  missions.unblockMission(f.missionId)
  advance(150_000)
  missions.resumeMission(f.missionId)
  expect(approval().expiresAt).toBe(new Date(Date.parse(before.expiresAt) + 240_000).toISOString())
  expect(events()).toHaveLength(2)
  expect(events().map((event) => event.after)).toEqual([
    {
      id: before.id,
      expiresAt: new Date(Date.parse(before.expiresAt) + 90_000).toISOString(),
      pausedMs: 90_000
    },
    { id: before.id, expiresAt: approval().expiresAt, pausedMs: 150_000 }
  ])
})

it('blocking and unblocking a Mission leaves the expiry of its approval where it was', () => {
  const before = approval()
  missions.blockMission(f.missionId, 'Waiting on a resource')
  advance(600_000)
  missions.unblockMission(f.missionId)
  expect(approval()).toEqual(before)
  expect(events()).toEqual([])
})

it('canceling a paused Mission advances a granted expiry without changing its status', () => {
  const before = approval()
  f.store.transitionApproval({ id: before.id, expectedStatus: 'PENDING', status: 'GRANTED' })
  missions.pauseMission(f.missionId)
  advance(60_000)
  missions.cancelMission(f.missionId, 'Cancel delivery')
  expect(approval()).toMatchObject({
    id: before.id,
    status: 'GRANTED',
    expiresAt: new Date(Date.parse(before.expiresAt) + 60_000).toISOString()
  })
  expect(events()).toHaveLength(1)
  expect(f.store.getMission(f.missionId)?.status).toBe('CANCELED')
})

it('leaving PAUSED does not write an expiry without an open delivery approval', () => {
  f.store.transitionApproval({ id: approval().id, expectedStatus: 'PENDING', status: 'REVOKED' })
  const before = approval()
  const update = vi.spyOn(f.store, 'updateApprovalExpiry')
  missions.pauseMission(f.missionId)
  advance(60_000)
  missions.resumeMission(f.missionId)
  expect(approval()).toEqual(before)
  expect(update).not.toHaveBeenCalled()
  expect(events()).toEqual([])
})

it('the pause interval ends at the persisted status event time', () => {
  const before = approval()
  const ticking = new MissionController(f.db, f.store, {
    now: () => {
      advance(1000)
      return now
    }
  })
  ticking.pauseMission(f.missionId)
  ticking.resumeMission(f.missionId)
  expect(approval().expiresAt).toBe(new Date(Date.parse(before.expiresAt) + 1000).toISOString())
  const resumed = f.store.getLatestReadModelAudit({
    missionId: f.missionId,
    events: ['mission.status'],
    status: 'READY_FOR_APPROVAL'
  })
  expect(events()[0].createdAt).toBe(resumed?.createdAt)
})
