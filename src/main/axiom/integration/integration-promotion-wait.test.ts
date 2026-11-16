import { expect, it } from 'vitest'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { gitAt } from './integration-fixture.test-support'
import { readIntegrationGit, writeIntegrationGit } from './integration-merge'
import {
  regressionFixtures,
  batchRuns,
  dueAgain,
  scratchReturned
} from './integration-regression-fixture.test-support'
import {
  blockTask,
  unblockTask,
  promotionEvents
} from './integration-promotion-fixture.test-support'

const fixture = regressionFixtures()

it('leaves a checked-out integration branch alone and promotes once it is free', async () => {
  const f = await fixture()
  const checkout = path.join(f.root, 'checked-out')
  await f.git('worktree', 'add', checkout, `axiom/integration/${f.missionId}`)
  const status = await gitAt(checkout, 'status', '--porcelain')
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'integration_branch_checked_out'
  })
  const batch = f.batches()[0]
  expect(batch.status).toBe('PROMOTABLE')
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.baseCommit)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(await gitAt(checkout, 'rev-parse', 'HEAD')).toBe(batch.baseCommit)
  expect(await gitAt(checkout, 'status', '--porcelain')).toBe(status)
  await f.git('worktree', 'remove', checkout)
  f.runtime.createManagedWorktree.mockClear()
  await dueAgain(f)
  await f.run()
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
  expect(f.batches()).toHaveLength(1)
  expect(batchRuns(f)).toHaveLength(1)
  for (const event of ['batch_started', 'batch_merged', 'regression_started']) {
    expect(f.audits().filter((e) => e.event === `integration.${event}`)).toHaveLength(1)
  }
  expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
  await scratchReturned(f)

  const moved = await fixture()
  const occupied = path.join(moved.root, 'checked-out')
  await moved.git('worktree', 'add', occupied, `axiom/integration/${moved.missionId}`)
  moved.enqueue()
  await moved.run()
  await moved.effects.stop()
  expect(moved.batches()[0].status).toBe('PROMOTABLE')
  await moved.git('worktree', 'remove', occupied)
  await moved.git('update-ref', moved.integrationRef, moved.candidate.commitSha)
  for (let i = 0; i < 2; i++) {
    await dueAgain(moved)
    await moved.run()
    await moved.effects.stop()
    expect(moved.effect()?.lastError).toBe('integration_head_moved')
  }
  expect(moved.effect()).toMatchObject({ status: 'failed', attempts: 3 })
  expect(moved.batches()[0].status).toBe('SUPERSEDED')
  expect(moved.store.getTaskStage(moved.task.taskId)?.stage).toBe('BLOCKED')
  expect(moved.audits().findLast((e) => e.event === 'task.stage')?.after).toMatchObject({
    reason: 'integration_unavailable'
  })
  expect(await moved.git('rev-parse', moved.integrationRef)).toBe(moved.candidate.commitSha)
})

it('waits with the promotion while the Task is blocked or the Mission is paused', async () => {
  for (const change of ['block', 'pause']) {
    const f = await fixture()
    const remove = f.runtime.removeManagedWorktree.getMockImplementation()!
    f.runtime.removeManagedWorktree.mockImplementationOnce(async (selector) => {
      if (change === 'block') {
        blockTask(f)
      } else {
        f.controller.pauseMission(f.missionId)
      }
      return remove(selector)
    })
    f.enqueue()
    await f.run()
    await f.effects.stop()
    expect(f.effect()).toMatchObject({ status: 'pending', attempts: 0 })
    expect(f.batches()[0].status).toBe('PROMOTABLE')
    expect(await f.git('rev-parse', f.integrationRef)).toBe(f.baseSha)
    expect(promotionEvents(f)).toEqual([])
    if (change === 'block') {
      expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
        stage: 'BLOCKED',
        previousStage: 'INTEGRATION_READY'
      })
      unblockTask(f)
    } else {
      expect(f.store.getMission(f.missionId)?.status).toBe('PAUSED')
      f.controller.resumeMission(f.missionId)
    }
    await dueAgain(f)
    await f.run()
    await f.effects.stop()
    expect(f.batches()[0].status).toBe('PROMOTED')
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
    expect(f.batches()).toHaveLength(1)
    expect(batchRuns(f)).toHaveLength(1)
  }
})

it('keeps git inside the directory it was given', async () => {
  const f = await fixture()
  const nested = path.join(f.repo, 'lost-scratch')
  await mkdir(nested)
  const head = await f.git('rev-parse', 'HEAD')
  const branch = await f.git('symbolic-ref', 'HEAD')
  await expect(readIntegrationGit(nested, ['rev-parse', '--show-toplevel'])).rejects.toThrow()
  await expect(writeIntegrationGit(nested, ['checkout', '--detach', f.baseSha])).rejects.toThrow()
  expect(await f.git('rev-parse', 'HEAD')).toBe(head)
  expect(await f.git('symbolic-ref', 'HEAD')).toBe(branch)
  expect((await readIntegrationGit(f.repo, ['rev-parse', 'HEAD'])).trim()).toBe(head)
  await writeIntegrationGit(f.repo, ['checkout', '--detach', f.baseSha])
  expect(await f.git('rev-parse', 'HEAD')).toBe(f.baseSha)
  const linked = path.join(f.root, 'linked')
  await f.git('worktree', 'add', '--detach', linked, head)
  expect((await readIntegrationGit(linked, ['rev-parse', 'HEAD'])).trim()).toBe(head)
  await writeIntegrationGit(linked, ['checkout', '--detach', f.baseSha])
  expect(await gitAt(linked, 'rev-parse', 'HEAD')).toBe(f.baseSha)
  await f.git('worktree', 'remove', linked)
})
