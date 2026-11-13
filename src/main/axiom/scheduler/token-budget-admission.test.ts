import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { planned } from '../mission-controller/controller-fixture.test-support'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { ArtifactStore } from '../artifacts/artifact-store'
import { AgentFactory } from '../agent-factory/agent-factory'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { RulesEngine } from '../decision-engine/rules-engine'
import { EffectOutbox } from '../outbox/effect-outbox'
import { recordBudgetEvidence, recordTokenSpend } from '../token-budget.test-support'
import { Scheduler } from './scheduler'

let f: ReturnType<typeof planned>
let root: string
let scheduler: Scheduler
beforeEach(async () => {
  f = planned()
  f.controller.startExecution(f.missionId)
  root = await mkdtemp(path.join(tmpdir(), 'axiom-token-admission-'))
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  scheduler = new Scheduler(
    f.db,
    f.store,
    f.controller,
    new ContextBuilder(f.store, new ArtifactStore(f.store, root)),
    new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => ['codex']),
    { effects: new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' }) }
  )
})
afterEach(async () => {
  f.db.close()
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
function cappedTask(limit: number, final = true) {
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  if (!task) {
    throw new Error('Missing ready Task')
  }
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: 'READY',
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: { maxTokens: limit } }
  })
  recordTokenSpend(f, f.missionId, task.taskId, 1230, final)
  f.store.updateTaskStage({ taskId: task.taskId, from: 'READY', to: 'READY', attemptCountDelta: 1 })
  return task
}
it('blocks a ready Task at admission once its usage reached the token budget', async () => {
  const task = cappedTask(1000)
  const result = await scheduler.scheduleRound(f.missionId, 'manual')
  expect(result.skipped).toContainEqual({ taskId: task.taskId, reason: 'task_tokens' })
  expect(result.admitted.length).toBeGreaterThan(0)
  expect(result.admitted.some((a) => a.taskId === task.taskId)).toBe(false)
  expect(f.store.getMission(f.missionId)?.status).toBe('EXECUTING')
  recordBudgetEvidence('task-token-admission', {
    result,
    task: f.store.getTaskStage(task.taskId),
    audits: f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => e.objectId === task.taskId)
  })
  expect(f.store.getTaskStage(task.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'READY',
    attemptCount: 1
  })
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toContainEqual(
    expect.objectContaining({
      actor: 'Scheduler',
      objectKind: 'task',
      objectId: task.taskId,
      event: 'budget.exhausted',
      after: { dimension: 'maxTokens', limit: 1000, used: 1230 }
    })
  )
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toContainEqual(
    expect.objectContaining({
      actor: 'Scheduler',
      objectId: task.taskId,
      event: 'task.stage',
      after: expect.objectContaining({ stage: 'BLOCKED', reason: 'token_budget_exhausted' })
    })
  )
  await scheduler.scheduleRound(f.missionId, 'manual')
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => e.event === 'budget.exhausted')
  ).toHaveLength(1)
})
it('blocks the Mission at admission once its usage reached the Mission token budget', async () => {
  cappedTask(5000)
  const policy = f.store.getPolicy(f.missionId)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.missionId, { ...policy, budget: { maxTokens: 1230 } })
  const result = await scheduler.scheduleRound(f.missionId, 'manual')
  expect(result).toMatchObject({ admitted: [], blocked: 'maxTokens' })
  expect(f.store.getMission(f.missionId)?.status).toBe('BLOCKED')
  recordBudgetEvidence('mission-token-admission', {
    result,
    mission: f.store.getMission(f.missionId),
    audits: f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => e.event === 'budget.exhausted')
  })
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toContainEqual(
    expect.objectContaining({
      actor: 'Scheduler',
      objectKind: 'mission',
      objectId: f.missionId,
      event: 'budget.exhausted',
      after: { dimension: 'maxTokens', limit: 1230, used: 1230 }
    })
  )
})
it('admits a Task below its token budget', async () => {
  const task = cappedTask(1231)
  expect((await scheduler.scheduleRound(f.missionId, 'manual')).admitted).toContainEqual(
    expect.objectContaining({ taskId: task.taskId, seq: 2 })
  )
})
it.each(['task', 'mission'] as const)(
  'rechecks the %s token cap after asynchronous contract construction',
  async (owner) => {
    const task = cappedTask(2000, false)
    const policy = f.store.getPolicy(f.missionId)
    if (!policy) {
      throw new Error('Missing policy')
    }
    if (owner === 'mission') {
      f.store.upsertPolicy(f.missionId, { ...policy, budget: { maxTokens: 2000 } })
    }
    const insert = f.store.insertContextPackage.bind(f.store)
    vi.spyOn(f.store, 'insertContextPackage').mockImplementation((input) => {
      const result = insert(input)
      if (input.taskId === task.taskId) {
        const row = f.store.listAttemptTokenUsage({ taskId: task.taskId })[0]
        if (!row) {
          throw new Error('Missing token reading')
        }
        f.store.upsertAttemptTokenUsage({ ...row, newTokens: 2000, inputTokens: 2000 })
      }
      return result
    })
    const result = await scheduler.scheduleRound(f.missionId, 'manual')
    expect(result.admitted.some((a) => a.taskId === task.taskId)).toBe(false)
    expect(f.store.getTaskStage(task.taskId)?.attemptCount).toBe(1)
    if (owner === 'mission') {
      expect(result.blocked).toBe('maxTokens')
      expect(f.store.getMission(f.missionId)?.status).toBe('BLOCKED')
    } else {
      expect(result.skipped).toContainEqual({ taskId: task.taskId, reason: 'task_tokens' })
      expect(f.store.getTaskStage(task.taskId)?.stage).toBe('BLOCKED')
    }
  }
)
it('blocks a zero token cap before the first Attempt', async () => {
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  if (!task) {
    throw new Error('Missing Task')
  }
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: 'READY',
    retryPolicy: task.retryPolicy,
    spec: { ...task.spec, budget: { maxTokens: 0 } }
  })
  expect((await scheduler.scheduleRound(f.missionId, 'manual')).skipped).toContainEqual({
    taskId: task.taskId,
    reason: 'task_tokens'
  })
  expect(f.store.listAttemptBindings({ missionId: f.missionId, taskId: task.taskId })).toEqual([])
  expect(
    f.store.listAuditEvents({ missionId: f.missionId }).find((e) => e.event === 'budget.exhausted')
      ?.after
  ).toEqual({ dimension: 'maxTokens', limit: 0, used: 0 })
})
