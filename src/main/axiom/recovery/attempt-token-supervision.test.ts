import { rmSync, writeFileSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { emptyTokenUsage } from '../../../shared/axiom-contract/token-usage'
import { recordUsageEvidence } from './token-usage-fixture.test-support'
import { tokenBudgetSupervisionFixture } from './token-budget-supervision-fixture.test-support'

let f: Awaited<ReturnType<typeof tokenBudgetSupervisionFixture>>
beforeEach(async () => {
  f = await tokenBudgetSupervisionFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('stops an Attempt when its Task reaches the token budget', async () => {
  f.cap(1230)
  f.rollout()
  const before = f.audits().length
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.supervised') {
      expect(f.db.db.isTransaction).toBe(true)
    }
    return append(input)
  })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  const audits = f
    .audits()
    .slice(before)
    .filter((row) => row.event !== 'attempt.cadence')
  expect(audits).toMatchObject([
    {
      event: 'attempt.supervised',
      after: {
        rule: 'budget_exhausted',
        mode: 'auto',
        action: 'stopped',
        thresholdTokens: 1230,
        usedTokens: 1230,
        thresholdSource: 'task'
      }
    },
    { event: 'attempt.stopped', after: { reason: 'budget_exhausted' } },
    { event: 'attempt.preserved' },
    { event: 'task.stage', after: { stage: 'NEEDS_FIX', reason: 'budget_exhausted' } },
    { event: 'task.stage', after: { stage: 'BLOCKED', reason: 'token_budget_exhausted' } }
  ])
  expect(f.recorded().result.status).toBe('preserved')
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'NEEDS_FIX',
    attemptCount: 1
  })
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)).toMatchObject({
    newTokens: 1230,
    final: true
  })
  recordUsageEvidence('token-stop', audits)
})

it('counts the earlier Attempts of the Task toward its token budget', async () => {
  f.cap(1000)
  f.store.upsertAttemptTokenUsage({
    ...emptyTokenUsage('complete'),
    attemptId: f.t01.attemptId,
    missionId: f.mission.id,
    taskId: f.t01.taskId,
    seq: 1,
    provider: 'codex',
    newTokens: 700,
    inputTokens: 700,
    final: true,
    measuredAt: new Date(f.now()).toISOString()
  })
  const next = f.next()
  f.rollout(300, f.startedAt + 1000)
  await f.tick()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.runtime, next.attemptId)
  expect(f.rule('budget_exhausted')).toMatchObject([
    { objectId: next.attemptId, after: { thresholdTokens: 1000, usedTokens: 1000 } }
  ])
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'BLOCKED', attemptCount: 2 })
})

it('leaves an Attempt running below the token budget or without one', async () => {
  f.cap(1231)
  f.rollout()
  await f.tick()
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)?.newTokens).toBe(1230)
  f.cap()
  await f.tick()
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.rule('budget_exhausted')).toEqual([])
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('records the token stop once when the stop is unconfirmed', async () => {
  f.cap(1000)
  f.rollout()
  f.receipt('stop_unknown')
  const before = f.audits().length
  await f.tick()
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.stop).toHaveBeenCalledOnce()
  expect(
    f
      .audits()
      .slice(before)
      .filter((row) => row.event !== 'attempt.unverifiable')
  ).toMatchObject([
    { event: 'attempt.supervised', after: { rule: 'budget_exhausted', action: 'stop_unknown' } },
    { event: 'attempt.stop_unknown', after: { reason: 'budget_exhausted' } }
  ])
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('uses known Task usage when the running Attempt has no readable usage', async () => {
  f.cap(1000)
  const file = f.rollout()
  f.cap()
  await f.tick()
  const next = f.next()
  rmSync(file)
  f.cap(1000)
  await f.tick()
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.runtime, next.attemptId)
  expect(f.rule('budget_exhausted')).toMatchObject([{ after: { usedTokens: 1230 } }])
})

it('stops a Claude Attempt using its new input cache-write and output tokens', async () => {
  f.cap(1230)
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ channel: 'headless', agent: 'claude' }), f.t01.attemptId)
  writeFileSync(
    f.eventsFile,
    `${JSON.stringify({
      type: 'assistant',
      message: {
        id: 'token-budget-claude-message',
        usage: {
          input_tokens: 1000,
          cache_creation_input_tokens: 200,
          cache_read_input_tokens: 10000,
          output_tokens: 30
        }
      }
    })}\n`
  )
  await f.tick()
  expect(f.rule('budget_exhausted')).toMatchObject([{ after: { usedTokens: 1230 } }])
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)).toMatchObject({
    provider: 'claude',
    newTokens: 1230,
    cachedInputTokens: 10000,
    final: true
  })
})

it('leaves an unreadable Attempt running when no known usage reaches the cap', async () => {
  f.cap(1000)
  await f.tick()
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)).toBeUndefined()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('leaves running Attempts alone when only the Mission token cap is exhausted', async () => {
  const policy = f.store.getPolicy(f.mission.id)
  if (!policy) {
    throw new Error('Missing token budget policy')
  }
  f.store.upsertPolicy(f.mission.id, { ...policy, budget: { ...policy.budget, maxTokens: 1000 } })
  f.rollout()
  await f.tick()
  expect(f.store.sumAttemptTokenUsage({ missionId: f.mission.id })).toBe(1230)
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})
