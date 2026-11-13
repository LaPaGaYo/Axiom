import { afterEach, beforeEach, expect, it } from 'vitest'
import { MissionUsageResponseSchema } from '../../../shared/axiom-contract/token-usage'
import {
  tokenUsageFixture,
  iso,
  recordUsageEvidence
} from '../recovery/token-usage-fixture.test-support'
import { createInput } from '../mission-controller/controller-fixture.test-support'

let f: ReturnType<typeof tokenUsageFixture>
beforeEach(() => {
  f = tokenUsageFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('shows the Task and Mission usage next to their limits', async () => {
  const second = f.prepare(f.bind('T02'), 'claude')
  const task = f.store.getTaskStage(f.t01.taskId)
  const policy = f.store.getPolicy(f.mission.id)
  if (!task || !policy) {
    throw new Error('Missing usage fixtures')
  }
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, budget: { maxTokens: 2000 } },
    retryPolicy: task.retryPolicy
  })
  f.store.upsertPolicy(f.mission.id, { ...policy, budget: { maxTokens: 9000 } })
  const firstUsage = {
    attemptId: f.t01.attemptId,
    seq: 1,
    provider: 'codex',
    newTokens: 1230,
    inputTokens: 3000,
    cachedInputTokens: 1900,
    cacheWriteTokens: 300,
    outputTokens: 130,
    reasoningTokens: 30,
    status: 'complete' as const,
    final: true,
    measuredAt: iso(f.now())
  }
  const secondUsage = {
    attemptId: second.attemptId,
    seq: 1,
    provider: 'claude',
    newTokens: 430,
    inputTokens: 30,
    cachedInputTokens: 2300,
    cacheWriteTokens: 300,
    outputTokens: 100,
    reasoningTokens: 0,
    status: 'partial' as const,
    final: false,
    measuredAt: iso(f.now())
  }
  f.store.upsertAttemptTokenUsage({ ...firstUsage, missionId: f.mission.id, taskId: task.taskId })
  f.store.upsertAttemptTokenUsage({
    ...secondUsage,
    missionId: f.mission.id,
    taskId: second.taskId
  })
  const before = f.snapshot()
  const response = await f.call('axiom.mission.usage', { missionId: f.mission.id })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error('Usage RPC refused')
  }
  const view = MissionUsageResponseSchema.parse(response.result)
  recordUsageEvidence('view', view)
  expect(view).toEqual({
    missionId: f.mission.id,
    limit: 9000,
    used: 1660,
    tasks: f.store.listTaskStages({ missionId: f.mission.id }).map((row) => ({
      taskId: row.taskId,
      limit: row.taskId === task.taskId ? 2000 : null,
      used: row.taskId === task.taskId ? 1230 : row.taskId === second.taskId ? 430 : 0,
      attempts:
        row.taskId === task.taskId
          ? [firstUsage]
          : row.taskId === second.taskId
            ? [secondUsage]
            : []
    }))
  })
  expect(
    await f.call('axiom.mission.usage', { missionId: f.mission.id, taskId: task.taskId })
  ).toMatchObject({
    ok: true,
    result: { ...view, tasks: [view.tasks.find((row) => row.taskId === task.taskId)] }
  })
  expect(f.store.sumAttemptTokenUsage({ missionId: f.mission.id })).toBe(1660)
  expect(f.store.sumAttemptTokenUsage({ taskId: task.taskId })).toBe(1230)
  expect(f.store.listAttemptTokenUsage({ taskId: second.taskId })).toHaveLength(1)
  expect(f.snapshot()).toEqual(before)
})

it('refuses the usage view for an unknown Mission or Task', async () => {
  const before = f.snapshot()
  expect(await f.call('axiom.mission.usage', { missionId: 'missing' })).toMatchObject({
    ok: false,
    error: { code: 'mission_not_found' }
  })
  expect(
    await f.call('axiom.mission.usage', { missionId: f.mission.id, taskId: 'missing' })
  ).toMatchObject({ ok: false, error: { code: 'task_not_found' } })
  const other = f.missions.createMission({
    ...createInput,
    repoId: 'other',
    repoPath: '/other'
  })
  const afterCreate = f.snapshot()
  expect(
    await f.call('axiom.mission.usage', { missionId: other.mission.id, taskId: f.t01.taskId })
  ).toMatchObject({ ok: false, error: { code: 'task_not_found' } })
  expect(f.snapshot()).toEqual(afterCreate)
  expect(before).not.toEqual(afterCreate)
})

it('never changes a finalized usage row', () => {
  const row = {
    attemptId: f.t01.attemptId,
    taskId: f.t01.taskId,
    missionId: f.mission.id,
    seq: 1,
    provider: 'codex',
    newTokens: 50,
    inputTokens: 50,
    cachedInputTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    status: 'complete' as const,
    final: true,
    measuredAt: iso(f.now())
  }
  f.store.upsertAttemptTokenUsage(row)
  expect(f.store.upsertAttemptTokenUsage({ ...row, newTokens: 100, final: false })).toBe(false)
  expect(f.store.getAttemptTokenUsage(row.attemptId)).toEqual(row)
  expect(f.store.listAttemptTokenUsage({ missionId: row.missionId })).toEqual([row])
})
