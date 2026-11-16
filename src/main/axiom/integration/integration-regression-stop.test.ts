import { expect, it, vi } from 'vitest'
import {
  regressionFixtures,
  regressionCommands,
  batchRuns,
  dueAgain,
  scratchReturned
} from './integration-regression-fixture.test-support'

const fixture = regressionFixtures()
const settledEvents = [
  'integration.regression_inconclusive',
  'integration.batch_failed',
  'integration.batch_promotable'
]

it('stops the regression at shutdown without spending a try or settling the batch', async () => {
  const f = await fixture()
  regressionCommands(f, [], { integrationGates: ['node -e "setTimeout(() => {}, 60000)"'] })
  f.enqueue()
  const flight = f.run()
  try {
    await vi.waitFor(
      () => expect(batchRuns(f).find((run) => run.status === 'RUNNING')).toBeDefined(),
      { timeout: 5000, interval: 20 }
    )
    const started = Date.now()
    await f.effects.stop()
    await flight
    expect(Date.now() - started).toBeLessThan(4000)
    expect(f.effect()).toMatchObject({ status: 'pending', attempts: 0 })
    expect(f.batches()[0].status).toBe('TESTING')
    const first = batchRuns(f)[0]
    expect(first.status).toBe('RUNNING')
    expect((await f.runtime.listManagedWorktrees()).worktrees).toHaveLength(1)
    expect(
      f
        .audits()
        .filter((e) => [...settledEvents, 'integration.regression_canceled'].includes(e.event))
    ).toEqual([])
    regressionCommands(f, [], { integrationGates: ['node -e ""'] })
    await f.run()
    expect(f.batches()[0].status).toBe('PROMOTABLE')
    expect(batchRuns(f).map((run) => run.status)).toEqual(['CANCELED', 'PASS'])
    expect(f.audits()).toContainEqual(
      expect.objectContaining({
        event: 'integration.regression_canceled',
        after: expect.objectContaining({ runId: first.id, reason: 'regression_retried' })
      })
    )
    await scratchReturned(f)
  } finally {
    await f.effects.stop()
    await flight
  }
})

it('ends a regression that is no longer current without spending a try', async () => {
  const f = await fixture()
  regressionCommands(f, [], { integrationGates: ['node -e "setTimeout(() => {}, 1500)"'] })
  f.enqueue()
  const flight = f.run()
  try {
    await vi.waitFor(
      () => expect(batchRuns(f).find((run) => run.status === 'RUNNING')).toBeDefined(),
      { timeout: 5000, interval: 20 }
    )
    const first = batchRuns(f)[0]
    f.controller.transitionTaskStage({
      taskId: f.task.taskId,
      to: 'BLOCKED',
      actor: 'user',
      reason: 'test'
    })
    await flight
    expect(f.store.getVerificationRun(first.id)?.status).toBe('CANCELED')
    await f.effects.stop()
    expect(f.audits()).toContainEqual(
      expect.objectContaining({
        event: 'integration.regression_canceled',
        after: expect.objectContaining({ runId: first.id, reason: 'regression_interrupted' })
      })
    )
    expect(f.effect()).toMatchObject({ status: 'pending', attempts: 0 })
    expect(f.batches()[0].status).toBe('TESTING')
    expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
      stage: 'BLOCKED',
      previousStage: 'INTEGRATION_READY'
    })
    expect(f.store.getCandidate(f.candidate.id)?.status).toBe('ACTIVE')
    await scratchReturned(f)
    expect(f.audits().filter((e) => settledEvents.includes(e.event))).toEqual([])
    f.controller.transitionTaskStage({
      taskId: f.task.taskId,
      to: 'INTEGRATION_READY',
      actor: 'user',
      reason: 'test'
    })
    await dueAgain(f)
    await f.run()
    expect(f.batches()[0].status).toBe('PROMOTABLE')
    expect(batchRuns(f).map((run) => run.status)).toEqual(['CANCELED', 'PASS'])
  } finally {
    await f.effects.stop()
    await flight
  }
})
