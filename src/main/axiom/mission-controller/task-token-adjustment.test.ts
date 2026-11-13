import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TaskResponseSchema } from '../../../shared/axiom-contract/task-params'
import { provenance } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { rpcFixture } from '../rpc-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { recordBudgetEvidence, recordTokenSpend } from '../token-budget.test-support'
import { createInput, propose } from './controller-fixture.test-support'

let f: ReturnType<typeof rpcFixture>
let missionId: string
let taskId: string
beforeEach(() => {
  f = rpcFixture()
  const { missions } = getAxiomControlPlane(f.runtime)
  const created = missions.createMission(createInput)
  missionId = created.mission.id
  const plan = propose(missions, missionId, created.goalRevision.id)
  missions.approvePlan({ planRevisionId: plan.id, resolver: 'user', provenance })
  const task = f.store.listTaskStages({ missionId })[0]
  if (!task) {
    throw new Error('Missing Task')
  }
  taskId = task.taskId
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: { maxTokens: 1000, maxRuntimeMinutes: 9 } }
  })
  recordTokenSpend(f, missionId, taskId, 1230)
  f.store.updateTaskStage({ taskId, from: task.stage, to: 'NEEDS_FIX', attemptCountDelta: 1 })
  missions.transitionTaskStage({
    taskId,
    to: 'BLOCKED',
    reason: 'token_budget_exhausted',
    actor: 'RecoveryService'
  })
})
afterEach(async () => {
  await getAxiomControlPlane(f.runtime).effects.stop()
  f.db.close()
  vi.restoreAllMocks()
})
const rationale = 'Authorize enough tokens to finish the preserved work.'
const adjust = (extra: Record<string, unknown>) =>
  f.call('axiom.task.adjust', { taskId, rationale, ...extra })
const snapshot = () => ({
  tasks: f.store.listTaskStages({ missionId }),
  audits: f.store.listAuditEvents({ missionId }),
  bindings: f.store.listAttemptBindings({ missionId }),
  usage: f.store.listAttemptTokenUsage({ missionId }),
  messages: f.store.listMessages({ missionId }),
  receipts: f.db.db
    .prepare(
      'SELECT caller_fingerprint, request_id, method, payload_hash, state, receipt, created_at, updated_at FROM mutation_receipts ORDER BY rowid'
    )
    .all()
})
it('raises the token budget of a blocked Task and makes it ready', async () => {
  const response = await adjust({ maxTokens: 5000 })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  expect(TaskResponseSchema.parse(response.result).task).toMatchObject({
    id: taskId,
    stage: 'READY'
  })
  expect(f.store.getTaskStage(taskId)).toMatchObject({
    stage: 'READY',
    previousStage: null,
    attemptCount: 1,
    spec: { budget: { maxTokens: 5000, maxRuntimeMinutes: 9 } }
  })
  const audits = f.store.listAuditEvents({ missionId })
  recordBudgetEvidence('task-token-adjustment', {
    response: response.result,
    task: f.store.getTaskStage(taskId),
    audits: audits.filter((e) => ['task.adjusted', 'plan.minor_adjustment'].includes(e.event))
  })
  expect(audits).toContainEqual(
    expect.objectContaining({
      event: 'task.adjusted',
      objectId: taskId,
      before: expect.objectContaining({ maxTokens: 1000 }),
      after: expect.objectContaining({ maxTokens: 5000, rationale })
    })
  )
  expect(audits).toContainEqual(
    expect.objectContaining({
      event: 'plan.minor_adjustment',
      after: expect.objectContaining({ maxTokens: 5000 })
    })
  )
  expect(audits.filter((e) => e.event === 'task.stage').slice(-2)).toMatchObject([
    { before: { stage: 'BLOCKED' }, after: { stage: 'NEEDS_FIX', reason: 'adjusted' } },
    { before: { stage: 'NEEDS_FIX' }, after: { stage: 'READY', reason: 'adjusted' } }
  ])
})
it('refuses a token budget at or below the usage of the Task', async () => {
  const before = snapshot()
  for (const maxTokens of [1000, 1230]) {
    expect(await adjust({ maxTokens })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument', data: { taskId, used: 1230, maxTokens } }
    })
    expect(snapshot()).toEqual(before)
  }
})
it('requires both exhausted budgets to be raised together', async () => {
  f.store.updateTaskStage({ taskId, from: 'BLOCKED', to: 'BLOCKED', attemptCountDelta: 1 })
  const before = snapshot()
  expect(await adjust({ maxTokens: 5000 })).toMatchObject({
    ok: false,
    error: { code: 'retry_budget_exhausted' }
  })
  expect(snapshot()).toEqual(before)
  expect(await adjust({ maxTokens: 5000, maxAttempts: 3 })).toMatchObject({ ok: true })
  expect(f.store.getTaskStage(taskId)).toMatchObject({
    stage: 'READY',
    retryPolicy: { maxAttempts: 3 },
    spec: { budget: { maxTokens: 5000 } }
  })
})
it('keeps an omitted token cap and omits it from adjustment audits', async () => {
  expect(await adjust({})).toMatchObject({ ok: true })
  expect(f.store.getTaskStage(taskId)?.spec.budget?.maxTokens).toBe(1000)
  for (const audit of f.store
    .listAuditEvents({ missionId })
    .filter((e) => ['task.adjusted', 'plan.minor_adjustment'].includes(e.event))) {
    expect(audit.after).not.toHaveProperty('maxTokens')
    if (audit.before) {
      expect(audit.before).not.toHaveProperty('maxTokens')
    }
  }
})
it('records a null prior cap when assigning the first token budget', async () => {
  const task = f.store.getTaskStage(taskId)
  if (!task) {
    throw new Error('Missing Task')
  }
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: { maxRuntimeMinutes: 9 } }
  })
  expect(await adjust({ maxTokens: 5000 })).toMatchObject({ ok: true })
  expect(
    f.store.listAuditEvents({ missionId }).find((e) => e.event === 'task.adjusted')?.before
  ).toHaveProperty('maxTokens', null)
})
