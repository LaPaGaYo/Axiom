import { symlinkSync } from 'node:fs'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { supervisionFixture } from './supervision-fixture.test-support'

let f: Awaited<ReturnType<typeof supervisionFixture>>
beforeEach(async () => {
  f = await supervisionFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('stops an Attempt over its runtime limit under the timeout rule', async () => {
  f.e2e(true)
  vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
  f.events(f.now() - 2000)
  const before = f.audits().length
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  expect(f.audits().slice(before)).toMatchObject([
    { event: 'attempt.supervised', after: { rule: 'stalled', mode: 'observe' } },
    { event: 'attempt.supervised', after: { rule: 'timeout', mode: 'auto', action: 'stopped' } },
    { event: 'attempt.stopped', after: { reason: 'timeout' } },
    { event: 'attempt.preserved' },
    { event: 'task.stage', after: { stage: 'NEEDS_FIX', reason: 'timeout' } },
    { event: 'task.stage', after: { stage: 'READY', reason: 'retry' } },
    {
      event: 'attempt.cadence',
      after: { maxEventGapMs: 2000, samples: 1, resolutionMs: 60_000, partial: false }
    }
  ])
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(f.recorded().result.status).toBe('preserved')
})

it('records the timeout rule with its threshold and source in the settlement', async () => {
  f.budget()
  const policy = f.store.getPolicy(f.mission.id)
  if (!policy) {
    throw new Error('Missing fixture policy')
  }
  f.store.upsertPolicy(f.mission.id, { ...policy, budget: { maxRuntimeMinutes: 1 } })
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.supervised') {
      expect(f.db.db.isTransaction).toBe(true)
    }
    return append(input)
  })
  await f.tick()
  expect(f.rule('timeout')).toMatchObject([
    {
      after: {
        taskId: f.t01.taskId,
        seq: 1,
        rule: 'timeout',
        mode: 'auto',
        thresholdMs: 60_000,
        thresholdSource: 'policy',
        elapsedMs: 120_000,
        action: 'stopped'
      }
    }
  ])
})

it('records the timeout rule once when the stop is unconfirmed', async () => {
  f.receipt('stop_unknown')
  await f.tick()
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.rule('timeout')).toMatchObject([
    {
      after: {
        rule: 'timeout',
        mode: 'auto',
        thresholdSource: 'task',
        action: 'stop_unknown'
      }
    }
  ])
  expect(f.audits().filter((row) => row.event === 'attempt.stop_unknown')).toMatchObject([
    { after: { reason: 'timeout' } }
  ])
  expect(f.stop).toHaveBeenCalledOnce()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
})

it('observes a silent headless Attempt once without changing its state', async () => {
  f.budget()
  f.setNow(f.startedAt + 1_300_000)
  f.events(f.startedAt)
  const before = f.snapshot().filter(({ name }) => name !== 'audit_events')
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    {
      after: {
        rule: 'stalled',
        mode: 'observe',
        thresholdMs: 1_200_000,
        thresholdSource: 'default',
        idleMs: 1_300_000,
        lastEventAt: new Date(f.startedAt).toISOString(),
        wouldActAt: new Date(f.startedAt + 1_200_000).toISOString()
      }
    }
  ])
  expect(f.snapshot().filter(({ name }) => name !== 'audit_events')).toEqual(before)
  f.setNow(f.now() + 60_000)
  await f.tick()
  f.events()
  await f.tick()
  f.setNow(f.now() + 1_300_000)
  await f.tick()
  expect(f.rule('stalled')).toHaveLength(1)
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.cadence()).toEqual([])
})

it('does not observe an Attempt whose events keep arriving', async () => {
  f.budget()
  for (let pass = 0; pass < 3; pass++) {
    f.setNow(f.now() + 1_300_000)
    f.events(f.now() - 100)
    await f.tick()
  }
  expect(f.rule('stalled')).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('skips the stall rule while the events file is missing', async () => {
  f.budget()
  f.setNow(f.now() + 1_300_000)
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'unchanged' }] })
  f.budget(1)
  await f.tick()
  expect(f.rule('stalled')).toEqual([])
  expect(f.rule('timeout')).toHaveLength(1)
  expect(f.cadence()).toEqual([])
})

it('keeps TUI Attempts out of the stall rule', async () => {
  f.budget()
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ agent: 'codex' }), f.t01.attemptId)
  vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(false)
  f.events(f.startedAt - 1_300_000)
  await f.tick()
  expect(f.rule('stalled')).toEqual([])
  expect(f.cadence()).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
})

it('skips unreadable event metadata without delaying the timeout', async () => {
  symlinkSync('events.jsonl', f.eventsFile)
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.rule('stalled')).toEqual([])
  expect(f.rule('timeout')).toHaveLength(1)
  expect(f.cadence()).toEqual([])
})

it('rolls back timeout supervision with the settlement on an audit failure', async () => {
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.preserved') {
      throw new Error('Fixture audit failure')
    }
    return append(input)
  })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'reconcile_failed' }] })
  expect(f.rule('timeout')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toEqual([])
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('uses the Task limit before the policy and keeps the strict timeout boundary', async () => {
  const policy = f.store.getPolicy(f.mission.id)
  if (!policy) {
    throw new Error('Missing fixture policy')
  }
  f.store.upsertPolicy(f.mission.id, { ...policy, budget: { maxRuntimeMinutes: 1 } })
  f.budget(2)
  await f.tick()
  expect(f.stop).not.toHaveBeenCalled()
  f.setNow(f.now() + 1)
  await f.tick()
  expect(f.rule('timeout')).toMatchObject([
    {
      after: {
        thresholdMs: 120_000,
        thresholdSource: 'task',
        elapsedMs: 120_001
      }
    }
  ])
})

it('still stops TUI Attempts at their limit without preservation or cadence', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ agent: 'codex' }), f.t01.attemptId)
  vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(false)
  await f.tick()
  expect(f.rule('timeout')).toMatchObject([{ after: { action: 'stopped' } }])
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(f.cadence()).toEqual([])
})
