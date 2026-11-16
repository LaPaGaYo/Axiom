import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  integrationFixture,
  gitAt,
  type IntegrationFixture
} from './integration-fixture.test-support'

let root: string
const fixtures: IntegrationFixture[] = []
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-integration-recovery-')))
})
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await f.effects.stop()
    f.db.close()
  }
  vi.restoreAllMocks()
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const directory = path.join(root, `case-${fixtures.length}`)
  await mkdir(directory)
  const f = await integrationFixture(directory)
  fixtures.push(f)
  return f
}
function seedBatch(f: IntegrationFixture, status: 'QUEUED' | 'APPLYING' = 'APPLYING') {
  return f.store.insertIntegrationBatch({
    id: `batch_${'a'.repeat(32)}`,
    missionId: f.missionId,
    candidateIds: [f.candidate.id],
    baseCommit: f.baseSha,
    status
  })
}
function orphan(f: IntegrationFixture) {
  f.enqueue()
  f.store.leaseDueEffect({
    kind: 'integration.apply',
    missionId: f.missionId,
    now: new Date().toISOString(),
    epoch: 'previous'
  })
}
async function finished(f: IntegrationFixture) {
  expect(f.effect()?.status).toBe('done')
  expect(f.batches()).toHaveLength(1)
  expect(f.batches()[0].status).toBe('TESTING')
  expect(await f.git('for-each-ref', '--format=%(refname)', 'refs/axiom/batches/')).toBe(
    `refs/axiom/batches/${f.batches()[0].id}/merged`
  )
  expect((await f.runtime.listManagedWorktrees()).worktrees).toEqual([])
  expect(await f.git('for-each-ref', 'refs/heads/axiom/integrating')).toBe('')
  expect(await f.git('rev-parse', f.integrationRef)).toBe(f.baseSha)
  expect(f.audits().filter((e) => e.event === 'integration.cleanup_failed')).toEqual([])
}

it('ends a stale request and defers one that is not due', async () => {
  for (const state of [
    'canceled',
    'superseded',
    'verified',
    'conflict',
    'paused',
    'blocked',
    'busy'
  ]) {
    const f = await fixture()
    if (state === 'canceled') {
      f.controller.cancelMission(f.missionId, 'test')
    }
    if (state === 'superseded') {
      f.store.supersedeActiveCandidates(f.task.taskId, 'successor')
    }
    if (state === 'verified') {
      f.store.updateTaskStage({ taskId: f.task.taskId, from: 'INTEGRATION_READY', to: 'VERIFIED' })
    }
    if (state === 'conflict') {
      const b = seedBatch(f)
      f.store.transitionIntegrationBatch({
        id: b.id,
        expectedStatus: 'APPLYING',
        status: 'CONFLICT',
        conflicts: ['file']
      })
    }
    if (state === 'paused') {
      f.controller.pauseMission(f.missionId)
    }
    if (state === 'blocked') {
      f.controller.transitionTaskStage({
        taskId: f.task.taskId,
        to: 'BLOCKED',
        reason: 'test',
        actor: 'test'
      })
    }
    if (state === 'busy') {
      f.store.insertIntegrationBatch({
        id: 'other',
        missionId: f.missionId,
        candidateIds: ['other-candidate'],
        status: 'APPLYING',
        baseCommit: f.baseSha
      })
      f.store.transitionIntegrationBatch({
        id: 'other',
        expectedStatus: 'APPLYING',
        status: 'TESTING',
        mergeCommit: f.baseSha
      })
    }
    const batches = f.store.listIntegrationBatches({ missionId: f.missionId })
    const audits = f.audits()
    const refs = await f.git('for-each-ref')
    f.enqueue()
    const started = Date.now()
    await f.run()
    const deferred = ['paused', 'blocked', 'busy'].includes(state)
    expect(f.effect()).toMatchObject({ status: deferred ? 'pending' : 'done', attempts: 0 })
    if (deferred) {
      expect(Date.parse(f.effect()!.dueAt)).toBeGreaterThanOrEqual(started + 30_000)
      expect(Date.parse(f.effect()!.dueAt)).toBeLessThanOrEqual(Date.now() + 30_000)
    }
    expect(f.store.listIntegrationBatches({ missionId: f.missionId })).toEqual(batches)
    expect(f.audits()).toEqual(audits)
    expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
    expect(f.runtime.showRepo).not.toHaveBeenCalled()
    expect(await f.git('for-each-ref')).toBe(refs)
  }
})

it('applies again after an interrupted run without a second batch or a leftover worktree', async () => {
  const f = await fixture()
  const batch = seedBatch(f)
  const created = await f.runtime.createManagedWorktree({
    repoSelector: 'id:repo',
    name: `integrate-${batch.id}-2`,
    branchNameOverride: `axiom/integrating/${batch.id}`,
    baseBranch: f.integrationRef
  })
  await gitAt(created.worktree.path, 'checkout', '--detach', f.baseSha)
  orphan(f)
  await f.run()
  await finished(f)
  expect(f.batches()[0].id).toBe(batch.id)
  expect(f.runtime.removeManagedWorktree).toHaveBeenCalledWith(`id:${created.worktree.id}`, {
    force: true,
    waitForBackgroundRemoval: true
  })

  const pinned = await fixture()
  const transition = pinned.store.transitionIntegrationBatch
  let firstMerge: string | undefined
  vi.spyOn(pinned.store, 'transitionIntegrationBatch').mockImplementation((input) => {
    if (input.status === 'TESTING' && firstMerge === undefined) {
      firstMerge = input.mergeCommit
      throw new Error('test_transaction_interrupted')
    }
    return transition(input)
  })
  pinned.enqueue()
  await pinned.run()
  expect(pinned.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'test_transaction_interrupted'
  })
  expect(pinned.batches()[0].status).toBe('APPLYING')
  const pin = `refs/axiom/batches/${pinned.batches()[0].id}/merged`
  expect(await pinned.git('rev-parse', pin)).toBe(firstMerge)
  await pinned.effects.stop()
  pinned.enqueue()
  await pinned.run()
  await finished(pinned)
  expect(pinned.batches()[0].mergeCommit).toBe(firstMerge)
  expect(pinned.audits().filter((e) => e.event === 'integration.batch_started')).toHaveLength(2)

  const suffixed = await fixture()
  const create = suffixed.runtime.createManagedWorktree.getMockImplementation()!
  let actualBranch = ''
  suffixed.runtime.createManagedWorktree.mockImplementation(async (args) => {
    actualBranch = `${args.branchNameOverride}-2`
    return create({ ...args, name: `${args.name}-2`, branchNameOverride: actualBranch })
  })
  suffixed.enqueue()
  await suffixed.run()
  await finished(suffixed)
  expect(await suffixed.git('for-each-ref', `refs/heads/${actualBranch}`)).toBe('')

  const moved = await fixture()
  const stale = seedBatch(moved)
  await moved.git('update-ref', moved.integrationRef, moved.candidate.commitSha)
  orphan(moved)
  const refs = await moved.git('for-each-ref')
  await moved.run()
  expect(moved.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'integration_head_moved'
  })
  expect(moved.batches()).toEqual([stale])
  expect(moved.runtime.createManagedWorktree).not.toHaveBeenCalled()
  expect(await moved.git('for-each-ref')).toBe(refs)
})

it('gives up after three failed tries, supersedes its batch and blocks the Task', async () => {
  const f = await fixture()
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  f.runtime.createManagedWorktree.mockRejectedValue(new Error('private runtime output'))
  const attempts = f.store.getTaskStage(f.task.taskId)!.attemptCount
  f.enqueue()
  await f.run()
  expect(f.effect()).toMatchObject({ status: 'pending', attempts: 1 })
  await vi.advanceTimersByTimeAsync(999)
  expect(f.runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  await f.effects.kick()
  expect(f.effect()).toMatchObject({ status: 'pending', attempts: 2 })
  await vi.advanceTimersByTimeAsync(4999)
  expect(f.runtime.createManagedWorktree).toHaveBeenCalledTimes(2)
  await vi.advanceTimersByTimeAsync(1)
  await f.effects.kick()
  expect(f.effect()).toMatchObject({
    status: 'failed',
    attempts: 3,
    lastError: 'scratch_worktree_unavailable'
  })
  expect(f.runtime.createManagedWorktree).toHaveBeenCalledTimes(3)
  expect(f.batches()).toHaveLength(1)
  expect(f.batches()[0].status).toBe('SUPERSEDED')
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'INTEGRATION_READY',
    attemptCount: attempts
  })
  expect(f.audits().findLast((e) => e.event === 'task.stage')?.after).toMatchObject({
    reason: 'integration_unavailable'
  })
  expect(f.audits().filter((e) => e.event === 'effect.failed')).toEqual([
    expect.objectContaining({
      after: {
        kind: 'integration.apply',
        key: f.candidate.id,
        attempts: 3,
        lastError: 'scratch_worktree_unavailable'
      }
    })
  ])
  expect(f.audits()).toContainEqual(
    expect.objectContaining({
      actor: 'IntegrationController',
      objectKind: 'integration_batch',
      objectId: f.batches()[0].id,
      before: null,
      event: 'integration.batch_abandoned',
      after: { status: 'SUPERSEDED', reason: 'integration_unavailable' }
    })
  )
})
