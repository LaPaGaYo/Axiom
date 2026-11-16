import { expect, it } from 'vitest'
import { regressionFixtures, staleRun } from './integration-regression-fixture.test-support'

const fixture = regressionFixtures()

it('closes its own open batch when the request has become stale', async () => {
  for (const change of ['verifying', 'superseded', 'canceled', 'testing']) {
    const f = await fixture()
    const batch = f.store.insertIntegrationBatch({
      id: 'stale-batch',
      missionId: f.missionId,
      candidateIds: [f.candidate.id],
      baseCommit: f.baseSha,
      status: 'APPLYING'
    })
    let runId: string | undefined
    if (change === 'testing') {
      f.store.transitionIntegrationBatch({
        id: batch.id,
        expectedStatus: 'APPLYING',
        status: 'TESTING',
        mergeCommit: f.candidate.commitSha
      })
      runId = staleRun(f).id
    }
    if (change === 'verifying' || change === 'testing') {
      f.store.updateTaskStage({ taskId: f.task.taskId, from: 'INTEGRATION_READY', to: 'VERIFYING' })
    } else if (change === 'superseded') {
      f.store.supersedeActiveCandidate(f.candidate.id)
    } else {
      f.controller.cancelMission(f.missionId, 'test')
    }
    f.enqueue()
    await f.run()
    expect(f.batches()[0].status).toBe('SUPERSEDED')
    expect(f.effect()).toMatchObject({ status: 'done', attempts: 0 })
    expect(f.store.listOpenIntegrationBatches(f.missionId)).toEqual([])
    expect(f.audits()).toContainEqual(
      expect.objectContaining({
        event: 'integration.batch_abandoned',
        objectId: batch.id,
        after: { status: 'SUPERSEDED', reason: 'request_stale' }
      })
    )
    if (runId) {
      expect(f.store.getVerificationRun(runId)).toMatchObject({
        status: 'CANCELED',
        finishedAt: expect.any(String)
      })
      expect(f.audits()).toContainEqual(
        expect.objectContaining({
          event: 'integration.regression_canceled',
          objectId: batch.id,
          after: expect.objectContaining({ runId, reason: 'request_stale' })
        })
      )
    }
    expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
  }
  const f = await fixture()
  f.store.insertIntegrationBatch({
    id: 'dead-other',
    missionId: f.missionId,
    candidateIds: ['missing-candidate'],
    baseCommit: f.baseSha,
    status: 'APPLYING'
  })
  f.enqueue()
  await f.run()
  expect(f.store.getIntegrationBatch('dead-other')?.status).toBe('SUPERSEDED')
  expect(f.audits()).toContainEqual(
    expect.objectContaining({
      event: 'integration.batch_abandoned',
      objectId: 'dead-other',
      after: { status: 'SUPERSEDED', reason: 'request_stale' }
    })
  )
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(f.effect()).toMatchObject({ status: 'done', attempts: 0 })
})
