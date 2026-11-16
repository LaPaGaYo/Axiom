import { expect, it } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { recordIntegrationBase } from './integration-fixture.test-support'
import {
  regressionFixtures,
  batchRuns,
  dueAgain,
  scratchReturned
} from './integration-regression-fixture.test-support'
import { anotherCandidate, promotionEvents } from './integration-promotion-fixture.test-support'

const fixture = regressionFixtures()

it('promotes a passed batch by advancing the integration head and integrates the Task', async () => {
  const f = await fixture()
  const hooks = path.join(f.root, 'hooks')
  await mkdir(hooks)
  await writeFile(
    path.join(hooks, 'reference-transaction'),
    '#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in refs/heads/axiom/integration/*) exit 1;; esac\ndone\n',
    { mode: 0o755 }
  )
  await f.git('config', 'core.hooksPath', hooks)
  const edges = f.store.listTaskEdges(f.missionId)
  const dependent = edges.find((edge) => edge.fromTaskId === f.task.taskId)!.toTaskId
  for (const edge of edges.filter((edge) => edge.toTaskId === dependent)) {
    if (edge.fromTaskId === f.task.taskId) {
      continue
    }
    const upstream = f.store.getTaskStage(edge.fromTaskId)!
    f.store.updateTaskStage({ taskId: upstream.taskId, from: upstream.stage, to: 'INTEGRATED' })
  }
  f.controller.recomputeReadiness(f.missionId)
  expect(f.store.getTaskStage(dependent)?.stage).toBe('DEFINED')
  const worktrees = await f.git('worktree', 'list', '--porcelain')
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('PROMOTED')
  const batch = f.batches()[0]
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
  expect(await f.git('show', '-s', '--format=%P', batch.mergeCommit!)).toBe(
    `${batch.baseCommit} ${f.candidate.commitSha}`
  )
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(f.audits()).toContainEqual(
    expect.objectContaining({
      event: 'task.stage',
      objectId: f.task.taskId,
      actor: 'IntegrationController',
      after: expect.objectContaining({ stage: 'INTEGRATED', reason: 'integration_promoted' })
    })
  )
  expect(f.store.getCandidate(f.candidate.id)?.status).toBe('ACTIVE')
  expect(f.effect()).toMatchObject({ status: 'done', attempts: 0 })
  const events = f
    .audits()
    .filter((e) => e.objectId === batch.id && e.event.startsWith('integration.'))
  expect(events.map((e) => e.event)).toEqual([
    'integration.batch_started',
    'integration.batch_merged',
    'integration.regression_started',
    'integration.batch_promotable',
    'integration.batch_promoted'
  ])
  expect(events[4].after).toEqual({
    status: 'PROMOTED',
    baseCommit: batch.baseCommit,
    mergeCommit: batch.mergeCommit,
    taskIntegrated: true,
    caughtUp: false
  })
  expect(batchRuns(f)).toHaveLength(1)
  await scratchReturned(f)
  expect(await f.git('worktree', 'list', '--porcelain')).toBe(worktrees)
  f.controller.recomputeReadiness(f.missionId)
  expect(f.store.getTaskStage(dependent)?.stage).toBe('READY')
  const before = { batches: f.batches(), runs: batchRuns(f), audits: f.audits() }
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.effect()?.status).toBe('done')
  expect({ batches: f.batches(), runs: batchRuns(f), audits: f.audits() }).toEqual(before)
  expect(await f.git('rev-parse', f.integrationRef)).toBe(batch.mergeCommit)
})

it('starts the next batch from the merge commit of the last promoted one', async () => {
  const f = await fixture()
  const other = await anotherCandidate(f)
  f.enqueue()
  other.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.batches()[0].status).toBe('PROMOTED')
  const first = f.batches()[0]
  const second = other.batch()
  expect(second).toMatchObject({ status: 'PROMOTED', baseCommit: first.mergeCommit })
  expect(await f.git('rev-parse', f.integrationRef)).toBe(second.mergeCommit)
  expect(await f.git('rev-parse', `${second.mergeCommit}^1`)).toBe(first.mergeCommit)
  expect(await f.git('show', `${f.integrationRef}:${f.scopePath}`)).toBe('immutable candidate')
  expect(await f.git('show', `${f.integrationRef}:${other.file}`)).toBe('second candidate')
  for (const taskId of [f.task.taskId, other.task.taskId]) {
    expect(f.store.getTaskStage(taskId)?.stage).toBe('INTEGRATED')
  }
  expect(promotionEvents(f).map((e) => e.objectId)).toEqual([first.id, second.id])
  await scratchReturned(f)
})

it('starts no batch when the integration head is not the recorded one', async () => {
  const f = await fixture()
  await f.git('update-ref', f.integrationRef, f.candidate.commitSha)
  f.enqueue()
  await f.run()
  await f.effects.stop()
  expect(f.effect()).toMatchObject({
    status: 'pending',
    attempts: 1,
    lastError: 'integration_head_unexpected'
  })
  expect(f.batches()).toEqual([])
  expect(f.runtime.createManagedWorktree).not.toHaveBeenCalled()
  expect(await f.git('rev-parse', f.integrationRef)).toBe(f.candidate.commitSha)
  for (let i = 0; i < 2; i++) {
    await dueAgain(f)
    await f.run()
    await f.effects.stop()
  }
  expect(f.effect()).toMatchObject({ status: 'failed', attempts: 3 })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('BLOCKED')
  expect(f.audits().findLast((e) => e.event === 'task.stage')?.after).toMatchObject({
    reason: 'integration_unavailable'
  })
  expect(f.batches()).toEqual([])

  const missing = await fixture()
  missing.db.db
    .prepare('DELETE FROM audit_events WHERE mission_id = ? AND event = ?')
    .run(missing.missionId, 'integration.base_created')
  missing.enqueue()
  await missing.run()
  await missing.effects.stop()
  expect(missing.effect()?.lastError).toBe('integration_head_unexpected')
  expect(missing.batches()).toEqual([])
  expect(missing.runtime.createManagedWorktree).not.toHaveBeenCalled()

  const recorded = await fixture()
  await recorded.git('update-ref', recorded.integrationRef, recorded.candidate.commitSha)
  recordIntegrationBase(recorded, recorded.candidate.commitSha)
  recorded.enqueue()
  await recorded.run()
  await recorded.effects.stop()
  expect(recorded.batches()[0].status).toBe('PROMOTED')
})
