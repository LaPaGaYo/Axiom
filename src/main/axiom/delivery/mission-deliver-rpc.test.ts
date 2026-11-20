import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import {
  deliveryFixture,
  deliveryEvents,
  decided,
  refused,
  pending,
  responseExample,
  eventExample,
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

it('mission.deliver fast forwards the target branch and consumes the approval and completes the Mission', async () => {
  const response = await deliver()
  const result = decided(response)
  expect(result.mission).toMatchObject({ status: 'COMPLETED', reason: 'delivered' })
  expect(result.approval).toMatchObject({
    id: f.approval.id,
    status: 'CONSUMED',
    outcome: 'fast_forwarded'
  })
  expect(f.move).toHaveBeenCalledTimes(1)
  expect(f.move).toHaveBeenCalledWith({
    repoPath: '/repository',
    ref: 'refs/heads/main',
    from: targetHead,
    to: integrationHead,
    hooks: 'on',
    reflogMessage: expect.stringContaining(f.missionId)
  })
  expect(f.move.mock.calls[0][0].reflogMessage).toContain('axiom')
  expect(f.store.getApproval(f.approval.id)).toEqual(result.approval)
  responseExample('delivered', response)
})

it('mission.deliver records mission.delivery_started before the branch write and one approval.consumed event after it', async () => {
  f.move.mockImplementation(async () => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(deliveryEvents(f, 'mission.delivery_started')).toHaveLength(1)
    expect(deliveryEvents(f, 'mission.delivery_started')[0]).toMatchObject({
      actor: 'user',
      objectKind: 'mission',
      objectId: f.missionId,
      before: null,
      after: {
        approvalId: f.approval.id,
        targetBranch: 'main',
        from: targetHead,
        to: integrationHead,
        via: 'desktop'
      }
    })
    expect(deliveryEvents(f, 'approval.consumed')).toEqual([])
    return { advanced: true, written: true }
  })
  decided(await deliver())
  const consumed = deliveryEvents(f, 'approval.consumed')
  expect(consumed).toHaveLength(1)
  expect(consumed[0]).toMatchObject({
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: f.approval.id,
    before: { status: 'GRANTED' },
    after: {
      id: f.approval.id,
      inputsHash: f.approval.inputsHash,
      outcome: 'fast_forwarded',
      targetBranch: 'main',
      from: targetHead,
      to: integrationHead,
      via: 'desktop'
    }
  })
  expect(deliveryEvents(f, 'mission.status').at(-1)?.after).toMatchObject({
    status: 'COMPLETED',
    reason: 'delivered'
  })
  eventExample('started', deliveryEvents(f, 'mission.delivery_started')[0])
  eventExample('consumed', consumed[0])
})

it('a delivered Mission shows its CONSUMED approval with outcome and execution time and lists nothing pending', async () => {
  const delivered = decided(await deliver())
  const shown = decided(await f.rpc.call('axiom.mission.show', { missionId: f.missionId }))
  expect(shown.mission.status).toBe('COMPLETED')
  expect(shown.approval).toEqual(delivered.approval)
  expect(shown.approval).toMatchObject({ status: 'CONSUMED', outcome: 'fast_forwarded' })
  expect(Number.isFinite(Date.parse(shown.approval?.executedAt ?? ''))).toBe(true)
  expect(await pending(f)).toEqual([])
})

it('mission.deliver refuses while the Mission is paused and delivers after the resume', async () => {
  decided(await f.rpc.call('axiom.mission.pause', { missionId: f.missionId, reason: 'Wait' }))
  expect(refused(await deliver(), 'illegal_transition').data).toEqual({
    missionId: f.missionId,
    from: 'PAUSED',
    command: 'deliver'
  })
  expect(f.move).not.toHaveBeenCalled()
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  decided(await f.rpc.call('axiom.mission.resume', { missionId: f.missionId, reason: 'Continue' }))
  expect(decided(await deliver()).mission.status).toBe('COMPLETED')
})

it('mission.deliver stops when the target branch is checked out and records the worktree and leaves the approval GRANTED', async () => {
  f.move.mockResolvedValue({
    advanced: false,
    reason: 'checked_out',
    worktreePath: '/repository/linked'
  })
  const response = await deliver()
  expect(refused(response, 'delivery_stopped').data).toEqual({
    ...f.input,
    reason: 'target_checked_out',
    targetBranch: 'main',
    worktreePath: '/repository/linked'
  })
  const events = deliveryEvents(f, 'mission.delivery_stopped')
  expect(events).toHaveLength(1)
  expect(events[0]).toMatchObject({
    actor: 'MissionController',
    objectKind: 'mission',
    objectId: f.missionId,
    before: null,
    after: {
      approvalId: f.approval.id,
      reason: 'target_checked_out',
      targetBranch: 'main',
      worktreePath: '/repository/linked',
      via: 'desktop'
    }
  })
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  responseExample('stopped', response)
})

it('a stopped delivery lists the item delivery_stopped that only offers cancel and a later delivery completes', async () => {
  f.move.mockResolvedValueOnce({
    advanced: false,
    reason: 'checked_out',
    worktreePath: '/repository/linked'
  })
  refused(await deliver(), 'delivery_stopped')
  const items = await pending(f)
  expect(items).toHaveLength(1)
  expect(items[0]).toMatchObject({
    kind: 'mission',
    reason: 'delivery_stopped',
    blocking: true,
    actions: ['axiom.mission.cancel'],
    since: deliveryEvents(f, 'mission.delivery_stopped')[0].createdAt
  })
  expect(items[0].summary).toContain('main')
  expect(items[0].summary).toContain('/repository/linked')
  expect(items[0].summary).toContain('Free')
  expect(items.some((item) => item.reason === 'delivery_approved')).toBe(false)
  expect(decided(await deliver()).mission.status).toBe('COMPLETED')
  expect(await pending(f)).toEqual([])
})

it('mission.deliver completes without a branch write when both commits of the report are the same', async () => {
  f.db.close()
  vi.restoreAllMocks()
  f = await deliveryFixture({ upToDate: true })
  const response = decided(await deliver())
  expect(response.mission.status).toBe('COMPLETED')
  expect(response.approval).toMatchObject({ status: 'CONSUMED', outcome: 'up_to_date' })
  expect(deliveryEvents(f, 'mission.delivery_started')).toEqual([])
  expect(f.move).not.toHaveBeenCalled()
})

it('a second delivery of the same Mission is refused while the first one is between its check and its record', async () => {
  let release = () => {}
  const waiting = new Promise<void>((resolve) => {
    release = resolve
  })
  let entered = () => {}
  const atWrite = new Promise<void>((resolve) => {
    entered = resolve
  })
  f.move.mockImplementation(async () => {
    entered()
    await waiting
    return { advanced: true, written: true }
  })
  const first = deliver()
  // A missing method must fail at an assertion rather than leave this test waiting.
  const reached = await Promise.race([atWrite.then(() => 'write'), first])
  if (typeof reached !== 'string') {
    expect(reached.ok).toBe(true)
  }
  expect(reached).toBe('write')
  try {
    expect(refused(await deliver(), 'delivery_unavailable').data).toEqual({
      ...f.input,
      reason: 'in_progress'
    })
  } finally {
    release()
  }
  expect(decided(await first).mission.status).toBe('COMPLETED')
  expect(f.move).toHaveBeenCalledTimes(1)
})

it('a Mission canceled while its branch was being moved is not completed and the started delivery stays on record', async () => {
  f.move.mockImplementation(async () => {
    decided(
      await f.rpc.call('axiom.mission.cancel', {
        missionId: f.missionId,
        reason: 'Cancel during delivery'
      })
    )
    return { advanced: true, written: true }
  })
  expect(refused(await deliver(), 'illegal_transition').data).toMatchObject({
    from: 'CANCELED',
    command: 'deliver'
  })
  expect(f.store.getMission(f.missionId)?.status).toBe('CANCELED')
  expect(f.store.getApproval(f.approval.id)?.status).toBe('GRANTED')
  expect(deliveryEvents(f, 'approval.consumed')).toEqual([])
  expect(deliveryEvents(f, 'mission.delivery_started')).toHaveLength(1)
  expect(deliveryEvents(f, 'mission.delivery_started')[0].after).toMatchObject({
    from: targetHead,
    to: integrationHead
  })
})
