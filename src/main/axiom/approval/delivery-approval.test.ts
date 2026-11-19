import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from '../db/axiom-store'
import { sha256 } from '../artifacts/artifact-store'
import {
  latestDeliveryApproval,
  requestDeliveryApproval,
  revokeDeliveryApprovals
} from './delivery-approval'

let db: OrchestrationDb
let store: AxiomStore
const missionId = 'mission'
const now = '2026-11-19T12:34:56.000Z'
const reportHash = sha256('completion report')
const request = () =>
  store.transaction('test_request', () =>
    requestDeliveryApproval(store, missionId, reportHash, now)
  )
const approvals = () => store.listApprovals({ missionId, actionKind: 'delivery' })
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())

it('a request inserts one PENDING delivery approval that expires 72 hours after the given time', () => {
  expect(latestDeliveryApproval(store, missionId)).toBeUndefined()
  const approval = request()
  expect(approvals()).toEqual([approval])
  expect(approval).toMatchObject({
    id: expect.stringMatching(/^approval/),
    missionId,
    actionKind: 'delivery',
    inputsHash: reportHash,
    risk: 'high',
    status: 'PENDING',
    requestedBy: 'MissionController',
    expiresAt: '2026-11-22T12:34:56.000Z',
    resolver: null,
    resolution: null
  })
  expect(latestDeliveryApproval(store, missionId)).toEqual(approval)
})

it('a second request revokes the open approval as superseded and inserts a new one', () => {
  const first = request()
  const granted = store.insertApproval({
    id: 'granted-open',
    missionId,
    actionKind: 'delivery',
    inputsHash: reportHash,
    risk: 'high',
    expiresAt: first.expiresAt,
    requestedBy: 'fixture'
  })
  store.transitionApproval({ id: granted.id, expectedStatus: 'PENDING', status: 'GRANTED' })
  const budget = store.insertApproval({
    id: 'budget',
    missionId,
    actionKind: 'budget_increase',
    inputsHash: reportHash,
    risk: 'high',
    expiresAt: first.expiresAt,
    requestedBy: 'fixture'
  })
  const second = request()
  expect(second.id).not.toBe(first.id)
  expect(approvals().filter((row) => row.status === 'PENDING')).toEqual([second])
  expect(store.getApproval(first.id)).toMatchObject({
    status: 'REVOKED',
    resolver: 'MissionController',
    resolution: 'superseded'
  })
  expect(store.getApproval(granted.id)).toMatchObject({
    status: 'GRANTED',
    resolver: null,
    resolution: null
  })
  expect(store.getApproval(budget.id)).toEqual(budget)
  expect(latestDeliveryApproval(store, missionId)).toEqual(second)
  store.transaction('test_revoke', () =>
    revokeDeliveryApprovals(store, missionId, 'mission_canceled', now)
  )
  expect(latestDeliveryApproval(store, missionId)?.status).toBe('REVOKED')
})

it('a request and a revocation each append one audit event', () => {
  const approval = request()
  expect(store.listAuditEvents({ missionId })).toEqual([
    expect.objectContaining({
      missionId,
      actor: 'MissionController',
      objectKind: 'approval',
      objectId: approval.id,
      event: 'approval.requested',
      before: null,
      after: {
        id: approval.id,
        actionKind: 'delivery',
        inputsHash: reportHash,
        expiresAt: approval.expiresAt
      },
      createdAt: now
    })
  ])
  const revoke = () =>
    store.transaction('test_revoke', () =>
      revokeDeliveryApprovals(store, missionId, 'mission_canceled', now)
    )
  revoke()
  revoke()
  const events = store.listAuditEvents({ missionId })
  expect(events).toHaveLength(2)
  expect(events[1]).toMatchObject({
    missionId,
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.revoked',
    before: { status: 'PENDING' },
    after: { id: approval.id, reason: 'mission_canceled' },
    createdAt: now
  })
})

it('a PENDING delivery approval is not a blocking approval', () => {
  request()
  expect(store.hasBlockingApproval(missionId)).toBe(false)
})
