import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'
import { MessageListResponseSchema } from '../../../shared/axiom-contract/message-params'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import { approval, backoff, binding, tokenBudget } from './pending-evidence.test-support'
import * as detection from '../../preflight/agent-detection'
import { createWaitingContext } from './waiting-context'
import { taskWaitingOn } from './task-waiting-on'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('names the pending question a Task waits on', async () => {
  const typed = f.message('T01')
  const gate = f.db.createGate({ taskId: f.task('T02').taskId, question: 'Unlisted gate' })
  const attempt = binding(f, 'T03')
  const kernel = f.db.createQuestion({
    runId: f.mission.runId,
    dispatchId: attempt.attemptId,
    askerHandle: 'worker',
    question: 'Kernel thread question'
  })
  for (const id of ['T01', 'T02', 'T03']) {
    expect((await f.show(id)).waitingOn).toEqual({
      on: 'question',
      reason: 'question',
      person: true
    })
  }
  const response = await f.call('axiom.message.list', { missionId: f.missionId, pendingOnly: true })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  const messages = MessageListResponseSchema.parse(response.result).messages
  expect(messages.map((message) => message.id)).toEqual(
    expect.arrayContaining([typed.id, kernel.message.id])
  )
  expect(
    messages.some((message) => message.id === gate.id || message.taskId === f.task('T02').taskId)
  ).toBe(false)
  for (const stage of ['DEFINED', 'READY', 'NEEDS_FIX', 'RUNNING', 'BLOCKED'] as const) {
    f.stage('T01', stage)
    expect((await f.show('T01')).waitingOn).toEqual({
      on: 'question',
      reason: 'question',
      person: true
    })
  }
})

it('names the exhausted budget a Task waits on', async () => {
  f.stage('T01', 'READY', 'fixture', 2)
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'budget',
    reason: 'task_attempts',
    person: true,
    budget: { scope: 'task', dimension: 'maxAttempts', limit: 2, used: 2 }
  })
  tokenBudget(f, 'T02', 100, 120)
  expect((await f.show('T02')).waitingOn).toEqual({
    on: 'budget',
    reason: 'task_tokens',
    person: true,
    budget: { scope: 'task', dimension: 'maxTokens', limit: 100, used: 120 }
  })
  f.policy({ budget: { maxAttempts: 2, maxTokens: 100 } })
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'budget',
    reason: 'budget_exhausted',
    person: true,
    budget: { scope: 'mission', dimension: 'maxAttempts', limit: 2, used: 2 }
  })
  f.policy({ budget: { maxTokens: 100 } })
  expect((await f.show('T03')).waitingOn).toEqual({
    on: 'budget',
    reason: 'budget_exhausted',
    person: true,
    budget: { scope: 'mission', dimension: 'maxTokens', limit: 100, used: 120 }
  })
  f.policy({ budget: {} })
  f.stage('T01', 'BLOCKED', 'retry_budget_exhausted')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'budget',
    reason: 'retry_budget_exhausted',
    person: true,
    budget: { scope: 'task', dimension: 'maxAttempts', limit: 2, used: 2 }
  })
  f.stage('T02', 'BLOCKED', 'token_budget_exhausted')
  expect((await f.show('T02')).waitingOn).toEqual({
    on: 'budget',
    reason: 'token_budget_exhausted',
    person: true,
    budget: { scope: 'task', dimension: 'maxTokens', limit: 100, used: 120 }
  })
  const task = f.task('T02')
  f.store.updateTaskSpec({
    taskId: task.taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, budget: {} },
    retryPolicy: task.retryPolicy
  })
  expect((await f.show('T02')).waitingOn).toEqual({
    on: 'budget',
    reason: 'token_budget_exhausted',
    person: true
  })
  await f.close()
  f = pendingFixture(false)
  f.status('EXECUTING')
  f.policy({ budget: { maxWallClockMinutes: 1 } })
  expect((await f.show('T01')).waitingOn).toMatchObject({
    on: 'budget',
    reason: 'budget_exhausted',
    person: true,
    budget: {
      scope: 'mission',
      dimension: 'maxWallClockMinutes',
      limit: 1,
      used: expect.any(Number)
    }
  })
  const atTwoMinutes = createWaitingContext(
    f.store,
    f.db,
    f.missionId,
    () => '2026-11-01T12:02:00.000Z'
  )
  expect(taskWaitingOn(atTwoMinutes, f.task('T01'))).toEqual({
    on: 'budget',
    reason: 'budget_exhausted',
    person: true,
    budget: { scope: 'mission', dimension: 'maxWallClockMinutes', limit: 1, used: 2 }
  })
})

it('names the same admission reason as the scheduler for a skipped ready Task', async () => {
  for (const cause of [
    'question',
    'approval',
    'backoff',
    'concurrency',
    'task_attempts',
    'no_eligible_provider'
  ] as const) {
    if (cause !== 'question') {
      await f.close()
      f = pendingFixture()
    }
    vi.spyOn(detection, 'detectInstalledAgentsWithShellPathHydration').mockResolvedValue(
      cause === 'no_eligible_provider' ? [] : ['codex']
    )
    vi.spyOn(f.runtime, 'resolveCodexHomeForWorkerLaunch').mockReturnValue(
      '/pending-fixture-account'
    )
    for (const row of f.store.listTaskStages({ missionId: f.missionId })) {
      if (row.spec.id !== 'T01') {
        f.stage(row.taskId, 'INTEGRATED')
      }
    }
    if (cause === 'question') {
      f.message('T01')
    }
    if (cause === 'approval') {
      approval(f)
    }
    if (cause === 'backoff') {
      backoff(f, 'T01')
    }
    if (cause === 'concurrency') {
      f.stage('T02', 'RUNNING')
      f.policy({ concurrencyLimit: 1 })
    }
    if (cause === 'task_attempts') {
      f.stage('T01', 'READY', 'fixture', 2)
    }
    const plane = getAxiomControlPlane(f.runtime)
    if (cause !== 'no_eligible_provider') {
      expect(
        await plane.agentFactory.selectWorkerProvider({
          missionId: f.missionId,
          taskId: f.task('T01').taskId
        })
      ).toBe('codex')
    }
    const result = await plane.scheduler.scheduleRound(f.missionId, 'manual')
    expect(result.admitted).toEqual([])
    expect(result.skipped).toEqual([{ taskId: f.task('T01').taskId, reason: cause }])
    const wait = (await f.show('T01')).waitingOn
    expect(wait.reason).toBe(result.skipped[0]?.reason)
    expect(f.task('T01').stage).toBe('READY')
    if (cause === 'backoff') {
      expect(wait.until).toBe('2099-01-01T00:00:00.000Z')
    }
    if (cause === 'no_eligible_provider') {
      expect(wait.person).toBe(true)
    }
  }
})

it('reads cooldown and backoff deadlines without making an admission decision', async () => {
  const dueAt = backoff(f, 'T01')
  expect((await f.show('T01')).waitingOn).toEqual({
    on: 'admission',
    reason: 'backoff',
    person: false,
    until: dueAt
  })
  f.audit('task', f.task('T02').taskId, 'task.admission_refused', {
    installed: ['codex', 'claude'],
    filtered: [],
    accountCooldown: [
      { provider: 'codex', until: '2099-02-01T00:00:00.000Z' },
      { provider: 'claude', until: '2099-01-01T00:00:00.000Z' }
    ]
  })
  expect((await f.show('T02')).waitingOn).toEqual({
    on: 'admission',
    reason: 'no_eligible_provider',
    person: false,
    until: '2099-01-01T00:00:00.000Z'
  })
  f.stage('T02', 'READY')
  expect((await f.show('T02')).waitingOn).toEqual({
    on: 'admission',
    reason: 'next_round',
    person: false
  })
})
