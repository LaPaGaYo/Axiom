import { expect, it } from 'vitest'
import {
  regressionFixtures,
  batchRuns,
  dueAgain
} from './integration-regression-fixture.test-support'
import {
  anotherCandidate,
  refusePromotions,
  blockTask,
  unblockTask,
  promotionEvents
} from './integration-promotion-fixture.test-support'

const fixture = regressionFixtures()

it('records a batch as promoted when the head already is its merge commit', async () => {
  const f = await fixture()
  refusePromotions(f)
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(await f.git('rev-parse', f.integrationRef)).toBe(f.batches()[0].mergeCommit)
  const batch = f.batches()[0]
  expect(batch.status).toBe('PROMOTABLE')
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(f.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'integration_batch_stale'
  })
  f.runtime.createManagedWorktree.mockClear()
  await dueAgain(f)
  await f.run()
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(promotionEvents(f)).toHaveLength(1)
  expect(promotionEvents(f)[0].after).toMatchObject({ caughtUp: true, taskIntegrated: true })
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
  expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
  expect(batchRuns(f)).toHaveLength(1)

  const exhausted = await fixture()
  refusePromotions(exhausted, 3)
  exhausted.enqueue()
  for (let i = 0; i < 3; i++) {
    if (i) {
      await dueAgain(exhausted)
    }
    await exhausted.run()
    await exhausted.effects.stop()
  }
  expect(exhausted.effect()).toMatchObject({ status: 'failed', attempts: 3 })
  expect(exhausted.batches()[0].status).toBe('PROMOTED')
  expect(exhausted.store.getTaskStage(exhausted.task.taskId)?.stage).toBe('INTEGRATED')
  expect(exhausted.audits().filter((e) => e.event === 'integration.batch_abandoned')).toEqual([])
  expect(promotionEvents(exhausted)).toHaveLength(1)

  const unreadable = await fixture()
  refusePromotions(unreadable)
  unreadable.enqueue()
  await unreadable.run()
  await unreadable.effects.stop()
  const show = unreadable.runtime.showRepo.getMockImplementation()!
  unreadable.runtime.showRepo.mockRejectedValue(new Error('private repository failure'))
  for (let i = 0; i < 2; i++) {
    await dueAgain(unreadable)
    await unreadable.run()
    await unreadable.effects.stop()
  }
  expect(unreadable.effect()).toMatchObject({
    status: 'failed',
    attempts: 3,
    lastError: 'integration_head_unavailable'
  })
  expect(unreadable.batches()[0].status).toBe('PROMOTABLE')
  expect(unreadable.store.getTaskStage(unreadable.task.taskId)?.stage).toBe('BLOCKED')
  expect(unreadable.audits().filter((e) => e.event === 'integration.batch_abandoned')).toEqual([])
  unreadable.controller.cancelMission(unreadable.missionId, 'human cancellation')
  unreadable.enqueue()
  await unreadable.run()
  await unreadable.effects.stop()
  expect(unreadable.effect()?.lastError).toBe('integration_head_unavailable')
  expect(unreadable.batches()[0].status).toBe('PROMOTABLE')
  unreadable.runtime.showRepo.mockImplementation(show)
  await dueAgain(unreadable)
  await unreadable.run()
  await unreadable.effects.stop()
  expect(unreadable.batches()[0].status).toBe('PROMOTED')
  expect(unreadable.store.getTaskStage(unreadable.task.taskId)?.stage).toBe('CANCELED')

  const cross = await fixture()
  const other = await anotherCandidate(cross)
  refusePromotions(cross)
  other.enqueue()
  await cross.run()
  await cross.effects.stop()
  expect(other.batch().status).toBe('PROMOTABLE')
  expect(await cross.git('rev-parse', cross.integrationRef)).toBe(other.batch().mergeCommit)
  cross.db.db
    .prepare('UPDATE axiom_effects SET due_at = ? WHERE effect_key = ?')
    .run(new Date(Date.now() + 3_600_000).toISOString(), other.candidate.id)
  cross.enqueue()
  await cross.run()
  await cross.effects.stop()
  expect(other.batch().status).toBe('PROMOTED')
  expect(cross.store.getTaskStage(other.task.taskId)?.stage).toBe('INTEGRATED')
  expect(cross.batches()[0]).toMatchObject({
    status: 'PROMOTED',
    baseCommit: other.batch().mergeCommit
  })
  expect(promotionEvents(cross).map((e) => e.objectId)).toEqual([
    other.batch().id,
    cross.batches()[0].id
  ])
})

it('keeps a block or a cancellation of the Task when the head has already moved', async () => {
  const f = await fixture()
  refusePromotions(f)
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(await f.git('rev-parse', f.integrationRef)).toBe(f.batches()[0].mergeCommit)
  blockTask(f)
  await dueAgain(f)
  await f.run()
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(promotionEvents(f)[0].after).toMatchObject({ taskIntegrated: false, caughtUp: true })
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'INTEGRATION_READY'
  })
  expect(f.effect()?.status).toBe('done')
  unblockTask(f)
  f.controller.pauseMission(f.missionId)
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(promotionEvents(f)).toHaveLength(1)

  const canceled = await fixture()
  refusePromotions(canceled)
  canceled.enqueue()
  await canceled.run()
  await canceled.effects.stop()
  canceled.controller.cancelTask({
    taskId: canceled.task.taskId,
    actor: 'henry',
    rationale: 'cancel'
  })
  await dueAgain(canceled)
  await canceled.run()
  await canceled.effects.stop()
  expect(canceled.batches()[0].status).toBe('PROMOTED')
  expect(canceled.store.getTaskStage(canceled.task.taskId)?.stage).toBe('CANCELED')
  expect(canceled.audits().filter((e) => e.event === 'integration.batch_abandoned')).toEqual([])
  expect(canceled.effect()?.status).toBe('done')
  expect(promotionEvents(canceled)[0].after).toMatchObject({ taskIntegrated: false })
})
