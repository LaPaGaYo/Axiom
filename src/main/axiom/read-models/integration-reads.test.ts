import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import * as integrationBase from '../execution/integration-base'
import { assertRecordedIntegrationHead } from '../integration/integration-head'
import { missionIntegration } from './integration-reads'
import {
  TaskListResponseSchema,
  TaskResponseSchema
} from '../../../shared/axiom-contract/task-params'
import { MissionResponseSchema } from '../../../shared/axiom-contract/mission-params'

let f: PendingFixture
const base = '1'.repeat(40)
const merged = '2'.repeat(40)

afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

async function result(method: string, params: unknown) {
  const response = await f.call(method, params)
  expect(response, JSON.stringify(response)).toMatchObject({ ok: true })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return response.result
}

function candidate(id: string, commitSha: string) {
  return f.store.insertCandidate({
    id,
    missionId: f.missionId,
    taskId: f.task('T01').taskId,
    attemptId: `attempt-${id}`,
    commitSha,
    treeSha: commitSha,
    status: 'ACTIVE',
    supersededBy: null
  })
}

function batch(id: string, candidateId: string) {
  return f.store.insertIntegrationBatch({
    id,
    missionId: f.missionId,
    candidateIds: [candidateId],
    baseCommit: base,
    status: 'APPLYING'
  })
}

it('a Task that no batch names has no integration', async () => {
  f = pendingFixture()
  const list = await result('axiom.task.list', { missionId: f.missionId })
  const { tasks } = z.object({ tasks: z.array(z.record(z.string(), z.unknown())) }).parse(list)
  expect(tasks.length).toBeGreaterThan(0)
  for (const task of tasks) {
    expect(task).not.toHaveProperty('integration')
    expect(await result('axiom.task.show', { taskId: task.id })).not.toHaveProperty(
      'task.integration'
    )
  }
})

it('a Task carries its latest batch', async () => {
  f = pendingFixture()
  const first = candidate('candidate-first', '3'.repeat(40))
  const firstBatch = batch('batch-first', first.id)
  expect(
    f.store.transitionIntegrationBatch({
      id: firstBatch.id,
      expectedStatus: 'APPLYING',
      status: 'CONFLICT',
      conflicts: ['src/first.ts']
    })
  ).toBe(true)
  expect(f.store.supersedeActiveCandidate(first.id)).toBe(true)
  const next = candidate('candidate-next', '4'.repeat(40))
  const nextBatch = batch('batch-next', next.id)
  expect(
    f.store.transitionIntegrationBatch({
      id: nextBatch.id,
      expectedStatus: 'APPLYING',
      status: 'TESTING',
      mergeCommit: merged
    })
  ).toBe(true)
  const stored = f.store.getIntegrationBatch(nextBatch.id)
  if (!stored) {
    throw new Error('Missing integration batch')
  }
  const expected = {
    batchId: stored.id,
    candidateId: next.id,
    status: stored.status,
    baseCommit: stored.baseCommit,
    mergeCommit: stored.mergeCommit,
    conflicts: stored.conflicts,
    updatedAt: new Date(`${stored.updatedAt.replace(' ', 'T')}Z`).toISOString()
  }
  const list = await result('axiom.task.list', { missionId: f.missionId })
  const show = await result('axiom.task.show', { taskId: first.taskId })
  expect(list).toMatchObject({
    tasks: expect.arrayContaining([
      expect.objectContaining({ id: first.taskId, integration: expected })
    ])
  })
  expect(show).toMatchObject({ task: { integration: expected } })
  const parsed = TaskListResponseSchema.parse(list)
  expect(parsed.tasks.find((task) => task.id === first.taskId)).toMatchObject({
    integration: expected
  })
  expect(TaskResponseSchema.parse(show)).toMatchObject({ task: { integration: expected } })
  for (const task of parsed.tasks.filter((task) => task.id !== first.taskId)) {
    expect(task).not.toHaveProperty('integration')
    expect(await result('axiom.task.show', { taskId: task.id })).not.toHaveProperty(
      'task.integration'
    )
  }
})

it('a conflicted batch keeps its paths after its candidate was superseded', async () => {
  f = pendingFixture()
  const first = candidate('candidate-conflict', '5'.repeat(40))
  const firstBatch = batch('batch-conflict', first.id)
  const conflicts = ['src/first.ts', 'src/second.ts']
  expect(
    f.store.transitionIntegrationBatch({
      id: firstBatch.id,
      expectedStatus: 'APPLYING',
      status: 'CONFLICT',
      conflicts
    })
  ).toBe(true)
  expect(f.store.supersedeActiveCandidate(first.id)).toBe(true)
  const expected = {
    batchId: firstBatch.id,
    candidateId: first.id,
    status: 'CONFLICT',
    mergeCommit: null,
    conflicts
  }
  expect(await result('axiom.task.list', { missionId: f.missionId })).toMatchObject({
    tasks: expect.arrayContaining([
      expect.objectContaining({ id: first.taskId, integration: expect.objectContaining(expected) })
    ])
  })
  expect(await result('axiom.task.show', { taskId: first.taskId })).toMatchObject({
    task: { integration: expected }
  })
})

it('the mission carries its integration branch and recorded head', async () => {
  f = pendingFixture(false)
  const params = { missionId: f.missionId }
  expect(await result('axiom.mission.show', params)).not.toHaveProperty('integration')
  vi.mocked(integrationBase.ensureIntegrationBase).mockResolvedValue({
    sha: base,
    created: true
  })
  expect(await result('axiom.mission.start', params)).not.toHaveProperty('integration')
  const expected = { branch: `axiom/integration/${f.missionId}`, recordedHead: base }
  const started = await result('axiom.mission.show', params)
  expect(started).toMatchObject({ integration: expected })
  expect(MissionResponseSchema.parse(started)).toMatchObject({ integration: expected })
  f.audit('integration_batch', 'batch-promoted', 'integration.batch_promoted', {
    mergeCommit: merged
  })
  const promoted = await result('axiom.mission.show', params)
  expect(promoted).toMatchObject({ integration: { ...expected, recordedHead: merged } })
  expect(MissionResponseSchema.parse(promoted)).toMatchObject({
    integration: { ...expected, recordedHead: merged }
  })
  const { missions } = z
    .object({ missions: z.array(z.record(z.string(), z.unknown())) })
    .parse(await result('axiom.mission.list', {}))
  expect(missions.length).toBeGreaterThan(0)
  for (const mission of missions) {
    expect(mission).not.toHaveProperty('integration')
  }
})

it('the head a reader shows is the head a batch start accepts', () => {
  f = pendingFixture()
  expect(missionIntegration(f.store, f.missionId)).toBeUndefined()
  expect(() => assertRecordedIntegrationHead(f.store, f.missionId, base)).toThrow(
    'integration_head_unexpected'
  )
  f.audit('mission', f.missionId, 'integration.base_created', { sha: base })
  expect(missionIntegration(f.store, f.missionId)?.recordedHead).toBe(base)
  f.audit('integration_batch', 'batch-promoted', 'integration.batch_promoted', {
    mergeCommit: merged
  })
  const integration = missionIntegration(f.store, f.missionId)
  expect(integration?.recordedHead).toBe(merged)
  if (!integration) {
    throw new Error('Missing recorded head')
  }
  expect(() =>
    assertRecordedIntegrationHead(f.store, f.missionId, integration.recordedHead)
  ).not.toThrow()
  expect(() => assertRecordedIntegrationHead(f.store, f.missionId, base)).toThrow(
    'integration_head_unexpected'
  )
  f.audit('mission', 'another-mission', 'integration.base_reused', { sha: base })
  expect(missionIntegration(f.store, f.missionId)).toEqual(integration)
  f.audit('mission', f.missionId, 'integration.base_reused', { sha: 'invalid-head' })
  expect(missionIntegration(f.store, f.missionId)).toBeUndefined()
  expect(() => assertRecordedIntegrationHead(f.store, f.missionId, merged)).toThrow(
    'integration_head_unexpected'
  )
  vi.spyOn(f.store, 'listAuditEvents').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  expect(() => missionIntegration(f.store, f.missionId)).toThrow('audit unavailable')
  expect(() => assertRecordedIntegrationHead(f.store, f.missionId, merged)).toThrow(
    'integration_head_unexpected'
  )
})

it('responses without the new fields still parse', async () => {
  f = pendingFixture()
  const list = await result('axiom.task.list', { missionId: f.missionId })
  const show = await result('axiom.task.show', { taskId: f.task('T01').taskId })
  const mission = await result('axiom.mission.show', { missionId: f.missionId })
  for (const task of TaskListResponseSchema.parse(list).tasks) {
    expect(task).not.toHaveProperty('integration')
  }
  expect(TaskResponseSchema.parse(show).task).not.toHaveProperty('integration')
  expect(MissionResponseSchema.parse(mission)).not.toHaveProperty('integration')
})
