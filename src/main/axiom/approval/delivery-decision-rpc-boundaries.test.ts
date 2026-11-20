import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { getAxiomControlPlane } from '../control-plane'
import { MissionControllerError } from '../mission-controller/controller-context'
import { latestDeliveryApproval, requestDeliveryApproval } from './delivery-approval'
import { sha256 } from '../artifacts/artifact-store'
import {
  waitingDeliveryFixture,
  decided,
  refused,
  pending
} from './delivery-decision-rpc.test-support'

let f: Awaited<ReturnType<typeof waitingDeliveryFixture>>
beforeEach(async () => {
  f = await waitingDeliveryFixture()
  expect(f.db).toBeInstanceOf(OrchestrationDb)
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
  vi.useRealTimers()
})
const audits = () => f.store.listAuditEvents({ missionId: f.missionId })
const grant = () => f.rpc.call('axiom.approval.grant', { approvalId: f.approval.id })

it('a bare future date is accepted and an expiry equal to now is expired', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2099-01-01T00:00:00.000Z'))
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2099-01-01' })
  refused(await grant(), 'approval_expired')
  const replacement = latestDeliveryApproval(f.store, f.missionId)
  if (!replacement) {
    throw new Error('Missing replacement')
  }
  f.store.updateApprovalExpiry({ id: replacement.id, expiresAt: '2099-01-02' })
  expect(
    decided(await f.rpc.call('axiom.approval.grant', { approvalId: replacement.id })).approval
      ?.status
  ).toBe('GRANTED')
})

it('a successful grant replays its receipt without a second decision', async () => {
  const envelope = { orchestrationRequestId: randomUUID() }
  const params = { approvalId: f.approval.id }
  const first = decided(await f.rpc.call('axiom.approval.grant', params, envelope))
  const before = audits()
  expect(decided(await f.rpc.call('axiom.approval.grant', params, envelope))).toEqual(first)
  expect(audits()).toEqual(before)
})

it('a denial rejects unknown and decided requests and waits until a blocked Mission is unblocked', async () => {
  const call = (approvalId: string) =>
    f.rpc.call('axiom.approval.deny', { approvalId, reason: 'No delivery' })
  refused(await call('missing'), 'approval_not_found')
  f.missions.blockMission(f.missionId, 'Resource unavailable')
  expect(refused(await call(f.approval.id), 'illegal_transition').data).toEqual({
    missionId: f.missionId,
    from: 'BLOCKED',
    command: 'deny'
  })
  expect(f.store.getApproval(f.approval.id)?.status).toBe('PENDING')
  f.missions.unblockMission(f.missionId)
  decided(await call(f.approval.id))
  expect(refused(await call(f.approval.id), 'approval_not_pending').data).toEqual({
    approvalId: f.approval.id,
    status: 'DENIED'
  })
})

it('denial accepts a stale report and never creates a replacement', async () => {
  const other = f.store.transaction('test_stale_denial', () =>
    requestDeliveryApproval(
      f.store,
      f.missionId,
      sha256('other report'),
      '2000-01-01T00:00:00.000Z'
    )
  )
  expect(
    decided(
      await f.rpc.call('axiom.approval.deny', { approvalId: other.id, reason: 'No delivery' })
    ).approval?.status
  ).toBe('DENIED')
  expect(f.store.listApprovals({ missionId: f.missionId })).toHaveLength(2)
  expect(audits().filter((event) => event.event === 'approval.expired')).toEqual([])
})

it('the dispatcher rejects a supplied resolver before either decision', async () => {
  const before = audits()
  for (const method of ['axiom.approval.grant', 'axiom.approval.deny']) {
    refused(
      await f.rpc.call(method, {
        approvalId: f.approval.id,
        resolver: 'someone',
        ...(method.endsWith('deny') ? { reason: 'No delivery' } : {})
      }),
      'invalid_argument'
    )
  }
  expect(f.store.getApproval(f.approval.id)).toEqual(f.approval)
  expect(audits()).toEqual(before)
})

it('a failed replacement rolls back the expiry and its audit', async () => {
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2000-01-01' })
  const before = audits()
  vi.spyOn(getAxiomControlPlane(f.rpc.runtime).store, 'insertApproval').mockImplementationOnce(
    () => {
      throw new MissionControllerError('stale_state', { approvalId: f.approval.id })
    }
  )
  refused(await grant(), 'stale_state')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('PENDING')
  expect(f.store.listApprovals({ missionId: f.missionId })).toHaveLength(1)
  expect(audits()).toEqual(before)
})

it('a failed grant audit rolls back the grant', async () => {
  const before = audits()
  vi.spyOn(getAxiomControlPlane(f.rpc.runtime).store, 'appendAuditEvent').mockImplementationOnce(
    () => {
      throw new MissionControllerError('stale_state', { approvalId: f.approval.id })
    }
  )
  refused(await grant(), 'stale_state')
  expect(f.store.getApproval(f.approval.id)).toEqual(f.approval)
  expect(audits()).toEqual(before)
})

it('a failed Mission block rolls back the denial and its audit', async () => {
  const before = audits()
  vi.spyOn(getAxiomControlPlane(f.rpc.runtime).store, 'updateMissionStatus').mockReturnValueOnce(
    false
  )
  refused(
    await f.rpc.call('axiom.approval.deny', { approvalId: f.approval.id, reason: 'No delivery' }),
    'stale_state'
  )
  expect(f.store.getApproval(f.approval.id)).toEqual(f.approval)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(audits()).toEqual(before)
})

it('report replacement and Mission cancellation leave a granted row GRANTED', async () => {
  decided(await grant())
  const granted = f.store.getApproval(f.approval.id)
  f.store.transaction('test_replaced_grant', () =>
    requestDeliveryApproval(f.store, f.missionId, sha256('new report'), '2000-01-01T00:00:00.000Z')
  )
  expect(f.store.getApproval(f.approval.id)).toEqual(granted)
  decided(
    await f.rpc.call('axiom.mission.cancel', { missionId: f.missionId, reason: 'Cancel delivery' })
  )
  expect(f.store.getApproval(f.approval.id)).toEqual(granted)
})

it('a pending item still shows an expired request until a grant is attempted', async () => {
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2000-01-01' })
  const before = audits()
  expect((await pending(f)).some((item) => item.reason === 'delivery_approval_pending')).toBe(true)
  expect(f.store.getApproval(f.approval.id)?.status).toBe('PENDING')
  expect(audits()).toEqual(before)
})
