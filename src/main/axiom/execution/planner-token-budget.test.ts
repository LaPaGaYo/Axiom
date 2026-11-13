import { afterEach, beforeEach, expect, it } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { recordTokenSpend } from '../token-budget.test-support'

let f: Awaited<ReturnType<typeof plannerFixture>>
beforeEach(async () => {
  f = await plannerFixture()
})
afterEach(async () => {
  await f.close()
})
it('refuses a Planner start once the Mission token budget is exhausted', async () => {
  const task = f.db.createTask({ spec: 'Earlier Worker', runId: f.mission.runId, deps: [] })
  recordTokenSpend(f, f.mission.id, task.id, 1230)
  const policy = f.store.getPolicy(f.mission.id)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.mission.id, { ...policy, budget: { maxTokens: 1230 } })
  const before = f.store.listAttemptBindings({ missionId: f.mission.id })
  await expect(createPlannerLauncher(f.deps).start(f.mission.id)).rejects.toMatchObject({
    code: 'invalid_argument',
    message: 'budget_exhausted',
    data: { reason: 'budget_exhausted' }
  })
  expect(f.store.listAttemptBindings({ missionId: f.mission.id })).toEqual(before)
  expect(f.startWorker).not.toHaveBeenCalled()
})
