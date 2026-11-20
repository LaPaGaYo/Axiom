import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { latestDeliveryApproval, requestDeliveryApproval } from './delivery-approval'
import { sha256 } from '../artifacts/artifact-store'
import { missionFinalization } from '../read-models/finalization-reads'
import { MissionController } from '../mission-controller/mission-controller'
import {
  waitingDeliveryFixture,
  decided,
  refused,
  pending,
  responseExample
} from './delivery-decision-rpc.test-support'

let f: Awaited<ReturnType<typeof waitingDeliveryFixture>>
beforeEach(async () => {
  f = await waitingDeliveryFixture()
  expect(f.db).toBeInstanceOf(OrchestrationDb)
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const grant = () => f.rpc.call('axiom.approval.grant', { approvalId: f.approval.id })
const deny = (reason = 'Needs another review') =>
  f.rpc.call('axiom.approval.deny', { approvalId: f.approval.id, reason })
const audits = () => f.store.listAuditEvents({ missionId: f.missionId })

it('approval.grant moves a waiting delivery approval to GRANTED and leaves the Mission READY_FOR_APPROVAL', async () => {
  const response = await grant()
  const result = decided(response)
  expect(result.mission.status).toBe('READY_FOR_APPROVAL')
  expect(result.approval).toMatchObject({ id: f.approval.id, status: 'GRANTED' })
  expect(f.store.getApproval(f.approval.id)).toEqual(result.approval)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  responseExample('grant', response)
})

it('approval.grant records the resolver user and the caller kind desktop in one approval.granted event', async () => {
  decided(await grant())
  expect(f.store.getApproval(f.approval.id)).toMatchObject({
    resolver: 'user',
    resolution: 'granted'
  })
  const events = audits().filter((event) => event.event === 'approval.granted')
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    actor: 'user',
    objectKind: 'approval',
    objectId: f.approval.id,
    before: { status: 'PENDING' },
    after: {
      id: f.approval.id,
      inputsHash: f.approval.inputsHash,
      expiresAt: f.approval.expiresAt,
      via: 'desktop'
    }
  })
  expect(Number.isFinite(Date.parse(events[0].createdAt))).toBe(true)
})

it('approval.grant refuses an unknown approval and an approval that is not PENDING', async () => {
  refused(await f.rpc.call('axiom.approval.grant', { approvalId: 'missing' }), 'approval_not_found')
  const other = f.store.insertApproval({
    id: 'budget',
    missionId: f.missionId,
    actionKind: 'budget_increase',
    inputsHash: f.approval.inputsHash,
    risk: 'high',
    expiresAt: f.approval.expiresAt,
    requestedBy: 'MissionController'
  })
  refused(await f.rpc.call('axiom.approval.grant', { approvalId: other.id }), 'approval_not_found')
  decided(await grant())
  expect(refused(await grant(), 'approval_not_pending').data).toEqual({
    approvalId: f.approval.id,
    status: 'GRANTED'
  })
})

it('approval.grant refuses while the Mission is paused and grants after the resume', async () => {
  decided(
    await f.rpc.call('axiom.mission.pause', { missionId: f.missionId, reason: 'Review later' })
  )
  expect(refused(await grant(), 'illegal_transition').data).toEqual({
    missionId: f.missionId,
    from: 'PAUSED',
    command: 'grant'
  })
  expect(f.store.getApproval(f.approval.id)?.status).toBe('PENDING')
  decided(
    await f.rpc.call('axiom.mission.resume', { missionId: f.missionId, reason: 'Review now' })
  )
  expect(decided(await grant()).approval?.status).toBe('GRANTED')
})

it('approval.grant refuses an approval whose hash is not the hash of the current report and writes nothing', async () => {
  const other = f.store.transaction('test_stale_report', () =>
    requestDeliveryApproval(f.store, f.missionId, sha256('another report'), f.approval.createdAt)
  )
  const before = audits()
  refused(await f.rpc.call('axiom.approval.grant', { approvalId: other.id }), 'approval_stale')
  expect(f.store.getApproval(other.id)).toEqual(other)
  expect(audits()).toEqual(before)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
})

it('approval.grant on an expired approval marks it EXPIRED and requests a new one and then refuses', async () => {
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2000-01-01' })
  const envelope = { orchestrationRequestId: randomUUID() }
  const params = { approvalId: f.approval.id }
  const response = await f.rpc.call('axiom.approval.grant', params, envelope)
  const error = refused(response, 'approval_expired')
  expect(f.store.getApproval(f.approval.id)).toMatchObject({
    status: 'EXPIRED',
    resolver: 'MissionController',
    resolution: 'expired'
  })
  const replacement = latestDeliveryApproval(f.store, f.missionId)
  expect(replacement).toMatchObject({ status: 'PENDING', inputsHash: f.approval.inputsHash })
  expect(replacement?.id).not.toBe(f.approval.id)
  expect(error.data).toEqual({ approvalId: f.approval.id, replacedBy: replacement?.id })
  expect(audits().filter((event) => event.event === 'approval.expired')).toHaveLength(1)
  refused(await f.rpc.call('axiom.approval.grant', params, envelope), 'approval_not_pending')
  expect(
    decided(await f.rpc.call('axiom.approval.grant', { approvalId: replacement?.id })).approval
      ?.status
  ).toBe('GRANTED')
  responseExample('expired', response)
})

it('approval.deny moves the approval to DENIED and the Mission to BLOCKED with the reason delivery_denied', async () => {
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2000-01-01' })
  const response = await deny()
  const result = decided(response)
  expect(result.approval).toMatchObject({
    status: 'DENIED',
    resolver: 'user',
    resolution: 'Needs another review'
  })
  expect(result.mission).toMatchObject({ status: 'BLOCKED', reason: 'delivery_denied' })
  expect(f.store.getApproval(f.approval.id)).toEqual(result.approval)
  const events = audits().filter((event) => event.event === 'approval.denied')
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    actor: 'user',
    objectKind: 'approval',
    objectId: f.approval.id,
    before: { status: 'PENDING' },
    after: { id: f.approval.id, reason: 'Needs another review', via: 'desktop' }
  })
  expect(audits().at(-1)?.after).toMatchObject({ status: 'BLOCKED', reason: 'delivery_denied' })
  responseExample('deny', response)
})

it('approval.deny refuses a reason that holds a secret and changes nothing', async () => {
  const before = audits()
  refused(await deny(['ghp', 'x'.repeat(32)].join('_')), 'invalid_argument')
  expect(f.store.getApproval(f.approval.id)).toEqual(f.approval)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(audits()).toEqual(before)
})

it('a denied Mission lists one blocking mission item that only offers cancel and can still be canceled', async () => {
  decided(await deny())
  const items = (await pending(f)).filter((item) => item.kind === 'mission')
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    reason: 'BLOCKED',
    summary: 'delivery_denied',
    blocking: true,
    actions: ['axiom.mission.cancel']
  })
  const canceled = decided(
    await f.rpc.call('axiom.mission.cancel', {
      missionId: f.missionId,
      reason: 'Canceled after denial'
    })
  )
  expect(canceled.mission.status).toBe('CANCELED')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('DENIED')
})

it('a granted Mission lists the item delivery_approved that only offers cancel', async () => {
  decided(await grant())
  const event = audits().find((entry) => entry.event === 'approval.granted')
  let now = '2099-01-01T00:00:00.000Z'
  const missions = new MissionController(f.db, f.store, { now: () => now })
  missions.pauseMission(f.missionId)
  now = '2099-01-02T00:00:00.000Z'
  missions.resumeMission(f.missionId)
  const items = (await pending(f)).filter((item) => item.kind === 'mission')
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    reason: 'delivery_approved',
    objectId: f.missionId,
    blocking: true,
    actions: ['axiom.mission.cancel'],
    since: event?.createdAt
  })
  const ready = missionFinalization(f.store, f.missionId)
  expect(ready?.outcome).toBe('ready')
  if (ready?.outcome !== 'ready') {
    throw new Error('Missing ready record')
  }
  for (const text of [
    ready.targetBranch,
    ready.integrationHead?.slice(0, 7),
    ready.targetHead?.slice(0, 7),
    ready.reportArtifactId
  ]) {
    expect(items[0].summary).toContain(text)
  }
})

it('both approval methods refuse a caller that is not the desktop', async () => {
  for (const method of ['axiom.approval.grant', 'axiom.approval.deny']) {
    const response = await f.rpc.dispatcher.dispatch({
      id: randomUUID(),
      authToken: 'test-caller',
      method,
      params: {
        approvalId: f.approval.id,
        ...(method.endsWith('deny') ? { reason: 'No delivery' } : {})
      },
      orchestrationContractVersion: 1,
      orchestrationRequestId: randomUUID()
    })
    refused(response, 'caller_not_desktop')
    expect(f.store.getApproval(f.approval.id)).toEqual(f.approval)
  }
})
