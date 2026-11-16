import { afterEach, expect, it, vi } from 'vitest'
import { requestIntegrations, shouldHoldIntegration } from './integration-admission'
import {
  admissionFixtures,
  recordStage,
  requestEvents,
  requestState,
  taskBySpec,
  verifyTask
} from './integration-admission.test-support'
import { regressionFixtures, dueAgain } from './integration-regression-fixture.test-support'
import {
  blockTask,
  unblockTask,
  refusePromotions
} from './integration-promotion-fixture.test-support'

const fixture = admissionFixtures()
const gitFixture = regressionFixtures()
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it('requests integration once a verified Task has a passing run', async () => {
  const f = await gitFixture()
  const { run } = verifyTask(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([
    f.task.taskId
  ])
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
  expect(
    f.store.getLatestReadModelAudit({
      missionId: f.missionId,
      objectKind: 'task',
      objectId: f.task.taskId,
      events: ['task.stage'],
      stage: 'INTEGRATION_READY'
    })
  ).toMatchObject({ actor: 'IntegrationController', after: { reason: 'integration_requested' } })
  expect(f.store.listEffects({ missionId: f.missionId })).toEqual([
    expect.objectContaining({
      kind: 'integration.apply',
      key: f.candidate.id,
      status: 'pending',
      payload: { taskId: f.task.taskId, candidateId: f.candidate.id }
    })
  ])
  expect(requestEvents(f)).toEqual([
    expect.objectContaining({
      actor: 'IntegrationController',
      objectKind: 'candidate',
      objectId: f.candidate.id,
      before: null,
      after: { taskId: f.task.taskId, runId: run!.id, again: false }
    })
  ])
  const before = requestState(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([])
  expect(requestState(f)).toEqual(before)
  await f.run()
  await f.effects.stop()
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')
  expect(f.batches()[0].status).toBe('PROMOTED')
  expect(await f.git('rev-parse', f.integrationRef)).toBe(f.batches()[0].mergeCommit)
})

it('leaves a verified Task alone without a passing run of its active candidate', async () => {
  for (const status of ['QUEUED', 'RUNNING', 'FAIL', 'HUMAN_REVIEW', 'CANCELED', null] as const) {
    const f = await fixture()
    const task = taskBySpec(f, f.task.spec.id === 'T01' ? 'T02' : 'T01')
    if (status) {
      verifyTask(f, task.taskId)
    }
    verifyTask(f, task.taskId, status)
    const before = requestState(f)
    expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([])
    expect(requestState(f)).toEqual(before)
  }
  const batch = await fixture()
  const task = taskBySpec(batch, batch.task.spec.id === 'T01' ? 'T02' : 'T01')
  verifyTask(batch, task.taskId, 'PASS', 'batch-only')
  const batchBefore = requestState(batch)
  expect(
    requestIntegrations(batch.store, batch.controller, batch.effects, batch.missionId)
  ).toEqual([])
  expect(requestState(batch)).toEqual(batchBefore)

  const superseded = await fixture()
  verifyTask(superseded)
  superseded.store.supersedeActiveCandidate(superseded.candidate.id)
  const before = requestState(superseded)
  expect(
    requestIntegrations(
      superseded.store,
      superseded.controller,
      superseded.effects,
      superseded.missionId
    )
  ).toEqual([])
  expect(requestState(superseded)).toEqual(before)

  const absent = await fixture()
  recordStage(
    absent,
    taskBySpec(absent, absent.task.spec.id === 'T01' ? 'T02' : 'T01').taskId,
    'VERIFIED'
  )
  const absentBefore = requestState(absent)
  expect(
    requestIntegrations(absent.store, absent.controller, absent.effects, absent.missionId)
  ).toEqual([])
  expect(requestState(absent)).toEqual(absentBefore)
})

it('waits until every upstream Task is integrated', async () => {
  const f = await fixture()
  const task = taskBySpec(f, 'T04')
  verifyTask(f, task.taskId)
  const upstream = f.store.listUpstreamEdges(task.taskId)
  expect(upstream.length).toBeGreaterThan(1)
  const before = requestState(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([])
  expect(requestState(f)).toEqual(before)
  for (const edge of upstream.slice(0, -1)) {
    recordStage(f, edge.fromTaskId, 'INTEGRATED')
  }
  const partial = requestState(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([])
  expect(requestState(f)).toEqual(partial)
  recordStage(f, upstream.at(-1)!.fromTaskId, 'INTEGRATED')
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([task.taskId])
})

it('requests Tasks in the order they were verified', async () => {
  const f = await fixture()
  const tasks = [taskBySpec(f, 'T01'), taskBySpec(f, 'T02')].sort((a, b) =>
    b.taskId.localeCompare(a.taskId)
  )
  const first = verifyTask(f, tasks[0].taskId)
  const second = verifyTask(f, tasks[1].taskId)
  expect(first.taskId > second.taskId).toBe(true)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([
    first.taskId,
    second.taskId
  ])
  expect(f.store.listEffects({ missionId: f.missionId }).map((e) => e.key)).toEqual([
    first.candidate.id,
    second.candidate.id
  ])
})

it('does nothing while the Mission is not executing or integration is held', async () => {
  const paused = await fixture()
  verifyTask(paused)
  paused.controller.pauseMission(paused.missionId)
  const before = requestState(paused)
  expect(
    requestIntegrations(paused.store, paused.controller, paused.effects, paused.missionId)
  ).toEqual([])
  expect(requestState(paused)).toEqual(before)
  paused.controller.resumeMission(paused.missionId)
  expect(
    requestIntegrations(paused.store, paused.controller, paused.effects, paused.missionId)
  ).toEqual([paused.task.taskId])

  const held = await fixture()
  verifyTask(held)
  vi.stubEnv('ORCA_E2E_HEADLESS', '1')
  vi.stubEnv('AXIOM_E2E_HOLD_INTEGRATION', '1')
  expect(shouldHoldIntegration()).toBe(true)
  const heldBefore = requestState(held)
  expect(requestIntegrations(held.store, held.controller, held.effects, held.missionId)).toEqual([])
  expect(requestState(held)).toEqual(heldBefore)
  vi.stubEnv('ORCA_E2E_HEADLESS', '0')
  vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '')
  expect(shouldHoldIntegration()).toBe(false)
  expect(requestIntegrations(held.store, held.controller, held.effects, held.missionId)).toEqual([
    held.task.taskId
  ])
})

it('asks again once the earlier request has ended and the Task is back in the queue', async () => {
  const f = await gitFixture()
  verifyTask(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([
    f.task.taskId
  ])
  const show = f.runtime.showRepo.getMockImplementation()!
  f.runtime.showRepo.mockRejectedValue(new Error('repository unavailable'))
  for (let i = 0; i < 3; i++) {
    if (i) {
      await dueAgain(f)
    }
    await f.run()
    await f.effects.stop()
  }
  expect(f.effect()).toMatchObject({ status: 'failed', attempts: 3 })
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'INTEGRATION_READY'
  })
  expect(f.audits().findLast((e) => e.objectId === f.task.taskId)?.after).toMatchObject({
    reason: 'integration_unavailable'
  })
  const before = requestState(f)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([])
  expect(requestState(f)).toEqual(before)
  f.controller.adjustTask({
    taskId: f.task.taskId,
    rationale: 'Repository restored',
    actor: 'user'
  })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATION_READY')
  f.runtime.showRepo.mockImplementation(show)
  expect(requestIntegrations(f.store, f.controller, f.effects, f.missionId)).toEqual([
    f.task.taskId
  ])
  expect(f.effect()).toMatchObject({ status: 'pending', attempts: 0, lastError: null })
  expect(requestEvents(f).map((e) => e.after)).toEqual([
    expect.objectContaining({ again: false }),
    { taskId: f.task.taskId, again: true }
  ])
  expect(requestEvents(f)[1]).toMatchObject({
    actor: 'IntegrationController',
    objectKind: 'candidate',
    objectId: f.candidate.id,
    before: null
  })
  await f.run()
  await f.effects.stop()
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('INTEGRATED')

  const delayed = await gitFixture()
  verifyTask(delayed)
  requestIntegrations(delayed.store, delayed.controller, delayed.effects, delayed.missionId)
  const dueAt = new Date(Date.now() + 3_600_000).toISOString()
  delayed.db.db
    .prepare('UPDATE axiom_effects SET due_at = ?, attempts = 1 WHERE id = ?')
    .run(dueAt, delayed.effect()!.id)
  const delayedBefore = requestState(delayed)
  expect(
    requestIntegrations(delayed.store, delayed.controller, delayed.effects, delayed.missionId)
  ).toEqual([])
  expect(delayed.effect()).toMatchObject({ status: 'pending', dueAt, attempts: 1 })
  expect(requestState(delayed)).toEqual(delayedBefore)
  delayed.store.leaseDueEffect({
    kind: 'integration.apply',
    missionId: delayed.missionId,
    now: dueAt,
    epoch: 'running-request'
  })
  const runningBefore = requestState(delayed)
  expect(delayed.effect()?.status).toBe('running')
  expect(
    requestIntegrations(delayed.store, delayed.controller, delayed.effects, delayed.missionId)
  ).toEqual([])
  expect(requestState(delayed)).toEqual(runningBefore)

  const promoted = await gitFixture()
  verifyTask(promoted)
  refusePromotions(promoted)
  requestIntegrations(promoted.store, promoted.controller, promoted.effects, promoted.missionId)
  await promoted.run()
  await promoted.effects.stop()
  blockTask(promoted)
  await dueAgain(promoted)
  await promoted.run()
  await promoted.effects.stop()
  expect(promoted.batches()[0].status).toBe('PROMOTED')
  expect(promoted.effect()?.status).toBe('done')
  unblockTask(promoted)
  expect(
    requestIntegrations(promoted.store, promoted.controller, promoted.effects, promoted.missionId)
  ).toEqual([promoted.task.taskId])
  await promoted.run()
  await promoted.effects.stop()
  expect(promoted.store.getTaskStage(promoted.task.taskId)?.stage).toBe('INTEGRATED')

  const unrequested = await gitFixture()
  expect(unrequested.effect()).toBeUndefined()
  expect(unrequested.store.getVerificationRun('vrun-1')?.status).toBe('QUEUED')
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const unrequestedBefore = requestState(unrequested)
  vi.spyOn(unrequested.store, 'getMission').mockImplementationOnce(() => {
    throw new Error('private storage detail')
  })
  expect(
    requestIntegrations(
      unrequested.store,
      unrequested.controller,
      unrequested.effects,
      unrequested.missionId
    )
  ).toEqual([])
  expect(requestState(unrequested)).toEqual(unrequestedBefore)
  const list = unrequested.store.listTaskStages
  vi.spyOn(unrequested.store, 'listTaskStages').mockImplementation((input) => {
    if (input.stage === 'VERIFIED') {
      throw new Error('private list detail')
    }
    return list(input)
  })
  expect(
    requestIntegrations(
      unrequested.store,
      unrequested.controller,
      unrequested.effects,
      unrequested.missionId
    )
  ).toEqual([unrequested.task.taskId])
  expect(requestEvents(unrequested).map((e) => e.after)).toEqual([
    { taskId: unrequested.task.taskId, again: true }
  ])
  expect(warn.mock.calls).toEqual([
    ['[axiom] Integration request failed', { missionId: unrequested.missionId }],
    ['[axiom] Integration request failed', { missionId: unrequested.missionId }]
  ])
})
