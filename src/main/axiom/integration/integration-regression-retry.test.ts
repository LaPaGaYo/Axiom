import { expect, it, vi } from 'vitest'
import {
  regressionFixtures,
  regressionCommands,
  batchRuns,
  dueAgain,
  scratchReturned,
  gateOutput,
  staleRun
} from './integration-regression-fixture.test-support'

const fixture = regressionFixtures()

it('keeps the batch in testing after an inconclusive regression and gives up after three tries', async () => {
  const f = await fixture()
  regressionCommands(f, ['axiom_regression_tool_does_not_exist_1243'])
  f.enqueue()
  await f.run()
  expect(f.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'regression_inconclusive'
  })
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('TESTING')
  const first = batchRuns(f)[0]
  expect(first).toMatchObject({
    status: 'INCONCLUSIVE',
    finishedAt: expect.any(String),
    verdictDetail: { reason: 'environment' }
  })
  expect(first.verdictDetail).not.toHaveProperty('escalation')
  expect(f.audits()).toContainEqual(
    expect.objectContaining({
      event: 'integration.regression_inconclusive',
      objectId: f.batches()[0].id,
      after: { status: 'TESTING', runId: first.id, reason: 'environment' }
    })
  )
  await scratchReturned(f)
  for (let index = 0; index < 2; index++) {
    await dueAgain(f)
    await f.run()
    await f.effects.stop()
  }
  expect(f.effect()).toMatchObject({
    status: 'failed',
    attempts: 3,
    lastError: 'regression_inconclusive'
  })
  expect(f.batches()[0].status).toBe('SUPERSEDED')
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'INTEGRATION_READY'
  })
  expect(f.audits().findLast((e) => e.event === 'task.stage')?.after).toMatchObject({
    reason: 'integration_unavailable'
  })
  expect(batchRuns(f)).toHaveLength(3)
  expect(batchRuns(f).map((run) => run.status)).toEqual([
    'INCONCLUSIVE',
    'INCONCLUSIVE',
    'INCONCLUSIVE'
  ])
  expect(f.store.getCandidate(f.candidate.id)?.status).toBe('ACTIVE')

  const invalid = await fixture()
  regressionCommands(invalid, ['node -e "process.exit(1)"'], { commands: [] })
  invalid.enqueue()
  await invalid.run()
  await invalid.effects.stop()
  expect(batchRuns(invalid)[0]).toMatchObject({
    status: 'INCONCLUSIVE',
    commands: [],
    toolVersions: {},
    verdictDetail: { reason: 'policy_invalid' }
  })
  expect(invalid.artifacts.list({ missionId: invalid.missionId, kind: 'log' })).toEqual([])

  const moved = await fixture()
  regressionCommands(moved, undefined, {
    integrationGates: [
      'git -c core.hooksPath= -c user.name=Regression -c user.email=regression@localhost commit --allow-empty --no-gpg-sign -m moved'
    ]
  })
  moved.enqueue()
  await moved.run()
  await moved.effects.stop()
  expect(batchRuns(moved)[0]).toMatchObject({
    status: 'INCONCLUSIVE',
    verdictDetail: { reason: 'environment', detail: 'scratch_changed' }
  })
  expect(moved.batches()[0].status).toBe('TESTING')
})

it('resumes a batch found in testing with a fresh regression run', async () => {
  const f = await fixture()
  regressionCommands(f, undefined, { integrationGates: ['git rev-parse HEAD'] })
  vi.spyOn(f.store, 'insertVerificationRun').mockImplementationOnce(() => {
    throw new Error('private store output')
  })
  f.enqueue()
  await f.run()
  await f.effects.stop()
  const first = { batch: f.batches()[0], effect: f.effect(), runs: batchRuns(f) }
  await dueAgain(f)
  await f.run()
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(first.effect).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'regression_unavailable'
  })
  expect(first.batch.status).toBe('TESTING')
  expect(first.runs).toEqual([])
  expect(f.batches()).toHaveLength(1)
  expect(f.batches()[0].mergeCommit).toBe(first.batch.mergeCommit)
  expect(f.audits().filter((e) => e.event === 'integration.batch_started')).toHaveLength(1)
  expect(f.audits().filter((e) => e.event === 'integration.batch_merged')).toHaveLength(1)
  expect(await gateOutput(f)).toBe(first.batch.mergeCommit)

  const orphan = await fixture()
  vi.spyOn(orphan.store, 'insertVerificationRun').mockImplementationOnce(() => {
    throw new Error('private store output')
  })
  orphan.enqueue()
  await orphan.run()
  await orphan.effects.stop()
  const previous = staleRun(orphan)
  await dueAgain(orphan)
  await orphan.run()
  expect(orphan.store.getVerificationRun(previous.id)).toMatchObject({
    status: 'CANCELED',
    finishedAt: expect.any(String)
  })
  expect(orphan.audits()).toContainEqual(
    expect.objectContaining({
      event: 'integration.regression_canceled',
      objectId: orphan.batches()[0].id,
      after: expect.objectContaining({ runId: previous.id, reason: 'regression_retried' })
    })
  )
  expect(batchRuns(orphan).map((run) => run.status)).toEqual(['CANCELED', 'PASS'])
  expect(orphan.batches()[0].status).toBe('PROMOTED')

  const moved = await fixture()
  vi.spyOn(moved.store, 'insertVerificationRun').mockImplementationOnce(() => {
    throw new Error('private store output')
  })
  moved.enqueue()
  await moved.run()
  await moved.effects.stop()
  const before = { batches: moved.batches(), runs: batchRuns(moved) }
  await moved.git('update-ref', moved.integrationRef, moved.candidate.commitSha)
  moved.runtime.createManagedWorktree.mockClear()
  await dueAgain(moved)
  await moved.run()
  expect(moved.effect()).toMatchObject({
    status: 'pending',
    attempts: 2,
    lastError: 'integration_head_moved'
  })
  expect(moved.runtime.createManagedWorktree).not.toHaveBeenCalled()
  expect({ batches: moved.batches(), runs: batchRuns(moved) }).toEqual(before)
})
