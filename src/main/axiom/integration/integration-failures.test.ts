import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { integrationFixture, type IntegrationFixture } from './integration-fixture.test-support'
import * as merge from './integration-merge'
import * as pins from '../execution/commit-pin'

let root: string
let f: IntegrationFixture
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-integration-failure-')))
  f = await integrationFixture(root)
})
afterEach(async () => {
  await f.effects.stop()
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

it.each(['repository', 'head', 'candidate', 'pin', 'merge', 'stale'] as const)(
  'records a fixed failure code for %s without exposing external output',
  async (failure) => {
    const expected = {
      repository: 'repository_not_local',
      head: 'integration_head_unavailable',
      candidate: 'candidate_unpinned',
      pin: 'merged_ref_conflict',
      merge: 'merge_failed',
      stale: 'integration_batch_stale'
    }
    if (failure === 'repository') {
      f.runtime.showRepo.mockResolvedValue({
        id: 'repo',
        path: f.repo,
        displayName: 'remote',
        addedAt: 0,
        badgeColor: '',
        connectionId: 'remote'
      })
    }
    if (failure === 'head') {
      f.runtime.showRepo.mockRejectedValue(new Error('private kernel output'))
    }
    if (failure === 'candidate') {
      f.db.db
        .prepare('UPDATE candidates SET commit_sha = ? WHERE id = ?')
        .run('f'.repeat(40), f.candidate.id)
    }
    if (failure === 'pin') {
      vi.spyOn(pins, 'pinCommit').mockResolvedValue({
        pinned: false,
        ref: 'occupied',
        reason: 'ref_conflict'
      })
    }
    if (failure === 'merge') {
      const create = f.runtime.createManagedWorktree.getMockImplementation()!
      f.runtime.createManagedWorktree.mockImplementation(async (args) => {
        const made = await create(args)
        // A kernel include can obstruct a tracked candidate file without creating a conflict.
        await mkdir(path.dirname(path.join(made.worktree.path, f.scopePath)), { recursive: true })
        await writeFile(path.join(made.worktree.path, f.scopePath), 'kernel include')
        return made
      })
    }
    if (failure === 'stale') {
      vi.spyOn(f.store, 'transitionIntegrationBatch').mockReturnValue(false)
    }
    f.enqueue()
    await f.run()
    expect(f.effect()).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: expected[failure]
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
    expect(f.store.getCandidate(f.candidate.id)?.status).toBe('ACTIVE')
    expect(await f.git('rev-parse', f.integrationRef)).toBe(f.baseSha)
    expect((await f.runtime.listManagedWorktrees()).worktrees).toEqual([])
    expect(await f.git('for-each-ref', 'refs/heads/axiom/integrating')).toBe('')
  }
)

it.each(['worktree_removal', 'branch_preserved', 'checkout'] as const)(
  'retains a settled batch when cleanup reports %s',
  async (failure) => {
    if (failure === 'worktree_removal') {
      f.runtime.removeManagedWorktree.mockRejectedValue(new Error('private removal output'))
    }
    if (failure === 'branch_preserved') {
      const remove = f.runtime.removeManagedWorktree.getMockImplementation()!
      f.runtime.removeManagedWorktree.mockImplementation(async (selector) => {
        await remove(selector)
        return { preservedBranch: 'kernel-preserved' }
      })
    }
    if (failure === 'checkout') {
      const write = merge.writeIntegrationGit
      vi.spyOn(merge, 'writeIntegrationGit').mockImplementation(async (cwd, args, env) => {
        if (args[0] === 'checkout' && args[1] !== '--detach') {
          throw new Error('private checkout output')
        }
        return write(cwd, args, env)
      })
    }
    f.enqueue()
    await f.run()
    expect(f.effect()).toMatchObject({ status: 'done', attempts: 0 })
    expect(f.batches()[0].status).toBe('TESTING')
    expect(f.runtime.removeManagedWorktree).toHaveBeenCalled()
    expect(f.audits().filter((e) => e.event === 'integration.cleanup_failed')).toEqual([
      expect.objectContaining({
        actor: 'IntegrationController',
        objectKind: 'integration_batch',
        objectId: f.batches()[0].id,
        before: null,
        after: { reason: failure === 'checkout' ? 'branch_preserved' : failure }
      })
    ])
  }
)

it('rechecks eligibility inside the transaction after reading the head', async () => {
  const show = f.runtime.showRepo.getMockImplementation()!
  f.runtime.showRepo.mockImplementation(async () => {
    f.controller.pauseMission(f.missionId)
    return show()
  })
  f.enqueue()
  await f.run()
  expect(f.effect()).toMatchObject({ status: 'pending', attempts: 0 })
  expect(f.batches()).toEqual([])
  expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
})

it('refreshes a queued base and permits a new batch after an abandoned batch', async () => {
  const abandoned = f.store.insertIntegrationBatch({
    id: 'abandoned',
    missionId: f.missionId,
    candidateIds: [f.candidate.id],
    baseCommit: f.baseSha,
    status: 'APPLYING'
  })
  f.store.transitionIntegrationBatch({
    id: abandoned.id,
    expectedStatus: 'APPLYING',
    status: 'SUPERSEDED'
  })
  const queued = f.store.insertIntegrationBatch({
    id: 'queued',
    missionId: f.missionId,
    candidateIds: [f.candidate.id],
    baseCommit: f.candidate.commitSha,
    status: 'QUEUED'
  })
  f.enqueue()
  await f.run()
  expect(f.effect()?.status).toBe('done')
  expect(f.batches()).toMatchObject([
    { id: abandoned.id, status: 'SUPERSEDED' },
    { id: queued.id, status: 'TESTING', baseCommit: f.baseSha }
  ])
})
