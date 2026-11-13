import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as usage from '../execution/codex-attempt-usage'
import { report } from '../execution/submission-fixture.test-support'
import { tokenBudgetSupervisionFixture } from './token-budget-supervision-fixture.test-support'

let f: Awaited<ReturnType<typeof tokenBudgetSupervisionFixture>>
beforeEach(async () => {
  f = await tokenBudgetSupervisionFixture()
  f.cap(1000)
  f.rollout()
})
afterEach(async () => {
  await f.cleanup()
})

it('does not stop after submission wins during token reading', async () => {
  const read = usage.readCodexAttemptUsage
  vi.spyOn(usage, 'readCodexAttemptUsage').mockImplementationOnce(async (...args) => {
    const result = await read(...args)
    expect(await f.submit()).toMatchObject({ ok: true })
    return result
  })
  await f.tick()
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeDefined()
  expect(f.rule('budget_exhausted')).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
})

it('does not use a token reading after a new admission changes its window', async () => {
  const read = usage.readCodexAttemptUsage
  vi.spyOn(usage, 'readCodexAttemptUsage').mockImplementationOnce(async (...args) => {
    const result = await read(...args)
    f.next()
    return result
  })
  await f.tick()
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 2 })
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.rule('budget_exhausted')).toEqual([])
})

it.each(['submitted', 'newer'] as const)(
  'guards token stop audits inside the transaction against a %s Attempt',
  async (race) => {
    const transaction = f.store.transaction.bind(f.store)
    vi.spyOn(f.store, 'transaction').mockImplementation((name, run) => {
      if (name === 'recovery_token_stop') {
        if (race === 'newer') {
          f.db.updateTaskStatus(f.t01.taskId, 'ready')
          f.prepareUsage(f.bind('T01'), f.startedAt + 1000, true)
        } else {
          const candidate = f.store.insertCandidate({
            id: 'token-race-candidate',
            taskId: f.t01.taskId,
            missionId: f.mission.id,
            attemptId: f.t01.attemptId,
            commitSha: 'a'.repeat(40),
            treeSha: 'b'.repeat(40),
            status: 'ACTIVE',
            supersededBy: null
          })
          f.store.insertSubmission({
            id: 'token-race-submission',
            missionId: f.mission.id,
            taskId: f.t01.taskId,
            attemptId: f.t01.attemptId,
            candidateId: candidate.id,
            report
          })
        }
      }
      return transaction(name, run)
    })
    expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
    if (race === 'submitted') {
      expect(f.store.getSubmissionByDispatch(f.t01.attemptId)?.id).toBe('token-race-submission')
    } else {
      expect(f.store.nextAttemptSeq(f.t01.taskId)).toBe(3)
    }
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.rule('budget_exhausted')).toEqual([])
    expect(
      f.audits().filter((row) => ['attempt.stopped', 'attempt.preserved'].includes(row.event))
    ).toEqual([])
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  }
)

it('rolls back token stop audits and Task settlement together on audit failure', async () => {
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.preserved') {
      throw new Error('fixture audit failure')
    }
    return append(input)
  })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'reconcile_failed' }] })
  expect(f.rule('budget_exhausted')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toEqual([])
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it.each(['stalled', 'timeout'] as const)(
  'keeps %s ahead of token enforcement in the same pass',
  async (rule) => {
    f.budget(1)
    f.cap(1000)
    if (rule === 'stalled') {
      f.e2e(true)
      vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
      f.events(f.now() - 2000)
      f.store.appendSupervisionSetting({
        rule: 'stalled',
        missionId: f.mission.id,
        mode: 'stop',
        actor: 'user'
      })
    }
    await f.tick()
    expect(f.rule(rule)).toHaveLength(1)
    expect(f.rule('budget_exhausted')).toEqual([])
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('READY')
  }
)

it('uses the preserved ledger maximum when a current reading regresses', async () => {
  f.cap()
  await f.tick()
  f.cap(1000)
  f.rollout(10)
  await f.tick()
  expect(f.rule('budget_exhausted')).toMatchObject([{ after: { usedTokens: 1230 } }])
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)).toMatchObject({
    newTokens: 1230,
    status: 'partial',
    final: true
  })
})

it('does not apply the Task token limit to a TUI Attempt', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ agent: 'codex' }), f.t01.attemptId)
  vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(false)
  await f.tick()
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.rule('budget_exhausted')).toEqual([])
  expect(f.store.getAttemptTokenUsage(f.t01.attemptId)).toBeUndefined()
})
