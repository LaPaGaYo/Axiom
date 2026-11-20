import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { latestDeliveryApproval, requestDeliveryApproval } from '../approval/delivery-approval'
import { executeFinalization } from '../finalization/mission-finalize'
import { goal, provenance } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  deliveryFixture,
  deliveryEvents,
  decided,
  refused,
  pending,
  responseExample,
  integrationHead,
  targetHead
} from './mission-deliver-rpc.test-support'

let f: Awaited<ReturnType<typeof deliveryFixture>>
beforeEach(async () => {
  f = await deliveryFixture()
  expect(f.db).toBeInstanceOf(OrchestrationDb)
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})
const deliver = () => f.rpc.call('axiom.mission.deliver', f.input)

it('mission.deliver refuses an unknown approval and an approval of another Mission', async () => {
  refused(
    await f.rpc.call('axiom.mission.deliver', { ...f.input, approvalId: 'missing' }),
    'approval_not_found'
  )
  const other = f.missions.createMission({
    repoId: 'repo',
    repoPath: '/repository',
    targetBranch: 'main',
    goal,
    provenance
  })
  const approval = f.store.transaction('other_approval', () =>
    requestDeliveryApproval(f.store, other.mission.id, f.approval.inputsHash, f.approval.createdAt)
  )
  refused(
    await f.rpc.call('axiom.mission.deliver', { ...f.input, approvalId: approval.id }),
    'approval_not_found'
  )
  expect(f.move).not.toHaveBeenCalled()
})

it('mission.deliver refuses an approval that is not GRANTED and moves no branch', async () => {
  f.db.close()
  vi.restoreAllMocks()
  f = await deliveryFixture({ grant: false })
  expect(refused(await deliver(), 'approval_not_granted').data).toEqual({
    approvalId: f.approval.id,
    status: 'PENDING'
  })
  expect(f.move).not.toHaveBeenCalled()
  decided(await f.rpc.call('axiom.approval.grant', { approvalId: f.approval.id }))
  decided(await deliver())
  expect(refused(await deliver(), 'approval_not_granted').data).toEqual({
    approvalId: f.approval.id,
    status: 'CONSUMED'
  })
  expect(f.move).toHaveBeenCalledTimes(1)
})

it('mission.deliver refuses a granted approval that is not the latest one of its Mission', async () => {
  f.store.transaction('supersede_delivery', () =>
    requestDeliveryApproval(f.store, f.missionId, f.approval.inputsHash, f.approval.createdAt)
  )
  const before = deliveryEvents(f)
  refused(await deliver(), 'approval_stale')
  expect(deliveryEvents(f)).toEqual(before)
  expect(f.move).not.toHaveBeenCalled()
})

it('mission.deliver on an expired approval requests a new one and then refuses and moves no branch', async () => {
  f.store.updateApprovalExpiry({ id: f.approval.id, expiresAt: '2000-01-01' })
  const envelope = { orchestrationRequestId: randomUUID() }
  const response = await f.rpc.call('axiom.mission.deliver', f.input, envelope)
  const error = refused(response, 'approval_expired')
  const replacement = latestDeliveryApproval(f.store, f.missionId)
  expect(replacement).toMatchObject({ status: 'PENDING', inputsHash: f.approval.inputsHash })
  expect(replacement?.id).not.toBe(f.approval.id)
  expect(error.data).toEqual({ approvalId: f.approval.id, replacedBy: replacement?.id })
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  expect(deliveryEvents(f, 'approval.lapsed')).toHaveLength(1)
  expect(deliveryEvents(f, 'approval.lapsed')[0]).toMatchObject({
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: f.approval.id,
    before: { status: 'GRANTED' },
    after: {
      id: f.approval.id,
      inputsHash: f.approval.inputsHash,
      expiresAt: '2000-01-01',
      replacedBy: replacement?.id
    }
  })
  expect(f.move).not.toHaveBeenCalled()
  refused(await f.rpc.call('axiom.mission.deliver', f.input, envelope), 'approval_stale')
  decided(await f.rpc.call('axiom.approval.grant', { approvalId: replacement?.id }))
  expect(
    decided(await f.rpc.call('axiom.mission.deliver', { ...f.input, approvalId: replacement?.id }))
      .mission.status
  ).toBe('COMPLETED')
  responseExample('expired_delivery', response)
})

it('mission.deliver returns the Mission to FINALIZING when the target branch moved or is gone and moves no branch', async () => {
  for (const reason of ['target_branch_moved', 'target_branch_not_found']) {
    if (reason === 'target_branch_not_found') {
      f.db.close()
      vi.restoreAllMocks()
      f = await deliveryFixture()
    }
    f.readGit.mockImplementation(async (_cwd, args) => {
      if (args[0] !== 'rev-parse') {
        return ''
      }
      if (reason === 'target_branch_not_found') {
        throw Object.assign(new Error('Absent'), { code: 1 })
      }
      return integrationHead
    })
    const response = await deliver()
    expect(refused(response, 'delivery_inputs_changed').data).toEqual({ ...f.input, reason })
    expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
    expect(deliveryEvents(f, 'mission.status').at(-1)?.after).toMatchObject({
      status: 'FINALIZING',
      reason
    })
    expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
    expect(f.move).not.toHaveBeenCalled()
    responseExample('inputs_changed', response)
  }
})

it('a branch found at the integration head without a write of this call returns the Mission to FINALIZING', async () => {
  f.move.mockResolvedValue({ advanced: true, written: false })
  expect(refused(await deliver(), 'delivery_inputs_changed').data).toEqual({
    ...f.input,
    reason: 'target_branch_moved'
  })
  expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  expect(deliveryEvents(f, 'approval.consumed')).toEqual([])
})

it('a return to FINALIZING requests finalization again and the old approval is refused afterwards', async () => {
  f.move.mockResolvedValue({ advanced: false, reason: 'moved' })
  refused(await deliver(), 'delivery_inputs_changed')
  await vi.waitFor(() => {
    expect(
      f.store
        .listEffects({ missionId: f.missionId })
        .filter((effect) => effect.kind === 'mission.finalize')
    ).toMatchObject([{ status: 'pending' }])
  })
  await executeFinalization({ ...f, runtime: f.rpc.runtime }, f.missionId)
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  const replacement = latestDeliveryApproval(f.store, f.missionId)
  expect(replacement).toMatchObject({ status: 'PENDING', inputsHash: f.approval.inputsHash })
  expect(replacement?.id).not.toBe(f.approval.id)
  refused(await deliver(), 'approval_stale')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  expect(f.move).toHaveBeenCalledTimes(1)
})

it('mission.deliver stops and moves no branch when the repository has a remote or demands verified signatures or the integration head is not the recorded one', async () => {
  for (const reason of [
    'remote_configured',
    'signature_verification_required',
    'integration_head_unexpected'
  ]) {
    f.readGit.mockImplementation(async (_cwd, args) => {
      if (args[0] === 'remote') {
        return reason === 'remote_configured' ? 'origin\n' : ''
      }
      if (args[0] === 'config') {
        return reason === 'signature_verification_required' ? 'true\n' : ''
      }
      return args[0] === 'rev-parse' ? targetHead : ''
    })
    f.readHead.mockResolvedValue(
      reason === 'integration_head_unexpected' ? targetHead : integrationHead
    )
    expect(refused(await deliver(), 'delivery_stopped').data).toEqual({
      ...f.input,
      reason,
      targetBranch: 'main'
    })
    expect(
      deliveryEvents(f, 'mission.delivery_stopped').filter(
        (event) =>
          event.after &&
          typeof event.after === 'object' &&
          !Array.isArray(event.after) &&
          event.after.reason === reason
      )
    ).toHaveLength(1)
    expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
    expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
    const items = await pending(f)
    expect(items[0].reason).toBe('delivery_stopped')
    expect(items[0].summary).toContain('main')
    expect(items[0].summary).toContain(
      {
        remote_configured: 'pull request',
        signature_verification_required: 'unsigned',
        integration_head_unexpected: 'recorded commit'
      }[reason]
    )
  }
  expect(f.move).not.toHaveBeenCalled()
  expect(deliveryEvents(f, 'mission.delivery_stopped')).toHaveLength(3)
})

it('mission.deliver refuses with delivery_unavailable and leaves the Mission and the approval as they were when git cannot be read or the write does not take', async () => {
  const before = deliveryEvents(f)
  f.readGit.mockRejectedValueOnce(new Error('Read failed'))
  expect(refused(await deliver(), 'delivery_unavailable').data).toEqual({
    ...f.input,
    reason: 'git_unreadable'
  })
  expect(deliveryEvents(f)).toEqual(before)
  expect(f.move).not.toHaveBeenCalled()
  f.move.mockResolvedValue({ advanced: false, reason: 'unavailable' })
  expect(refused(await deliver(), 'delivery_unavailable').data).toEqual({
    ...f.input,
    reason: 'write_not_taken'
  })
  expect(
    deliveryEvents(f)
      .slice(before.length)
      .map((event) => event.event)
  ).toEqual(['mission.delivery_started'])
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
})

it('mission.deliver refuses a caller that is not the desktop', async () => {
  refused(
    await f.rpc.dispatcher.dispatch({
      id: randomUUID(),
      authToken: 'test-caller',
      method: 'axiom.mission.deliver',
      params: f.input,
      orchestrationContractVersion: 1,
      orchestrationRequestId: randomUUID()
    }),
    'caller_not_desktop'
  )
  expect(f.move).not.toHaveBeenCalled()
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
})
