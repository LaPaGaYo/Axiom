import { appendFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as codexUsage from '../execution/codex-attempt-usage'
import {
  tokenUsageFixture,
  recordUsageEvidence,
  usageStart,
  usageThread,
  usageDecoy,
  iso
} from './token-usage-fixture.test-support'

const usageA = {
  input_tokens: 1000,
  cached_input_tokens: 400,
  cache_write_input_tokens: 100,
  output_tokens: 50,
  reasoning_output_tokens: 10,
  total_tokens: 1050
}
const usageB = {
  input_tokens: 2000,
  cached_input_tokens: 1500,
  cache_write_input_tokens: 200,
  output_tokens: 80,
  reasoning_output_tokens: 20,
  total_tokens: 2080
}
function tokenRecord(at: number, last = usageA, total = last) {
  return {
    timestamp: iso(at),
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: { total_token_usage: total, last_token_usage: last },
      rate_limits: { plan_type: usageDecoy, credits: { has_credits: true } }
    }
  }
}
function codexRecords(at = usageStart) {
  const first = tokenRecord(at)
  return [
    { type: 'session_meta', payload: { creator_account_id: usageDecoy } },
    {
      timestamp: iso(at - 1),
      type: 'event_msg',
      payload: { type: 'token_count', info: null, rate_limits: { plan_type: usageDecoy } }
    },
    first,
    tokenRecord(at + 1000, usageB, {
      input_tokens: 3000,
      cached_input_tokens: 1900,
      cache_write_input_tokens: 300,
      output_tokens: 130,
      reasoning_output_tokens: 30,
      total_tokens: 3130
    }),
    first
  ]
}
function claudeRecords() {
  const assistant = (
    id: string,
    input: number,
    writes: number,
    cached: number,
    output: number
  ) => ({
    type: 'assistant',
    parent_tool_use_id: id === 'B' ? 'subagent' : null,
    message: {
      id,
      usage: {
        input_tokens: input,
        cache_creation_input_tokens: writes,
        cache_read_input_tokens: cached,
        output_tokens: output
      }
    }
  })
  return [
    assistant('A', 10, 300, 1000, 5),
    assistant('A', 10, 300, 1000, 40),
    assistant('B', 20, 0, 1300, 60),
    { type: 'result', usage: { input_tokens: 999999 } }
  ]
}

let f: ReturnType<typeof tokenUsageFixture>
beforeEach(() => {
  f = tokenUsageFixture()
})
afterEach(async () => {
  await f.cleanup()
})

it('meters a running Codex Attempt from the per-call records of its rollout', async () => {
  f.rollout(codexRecords())
  await f.tick()
  expect(f.ledger()).toEqual([
    {
      dispatch_id: f.t01.attemptId,
      mission_id: f.mission.id,
      task_id: f.t01.taskId,
      seq: 1,
      provider: 'codex',
      new_tokens: 1230,
      input_tokens: 3000,
      cached_input_tokens: 1900,
      cache_write_tokens: 300,
      output_tokens: 130,
      reasoning_tokens: 30,
      status: 'complete',
      final: 0,
      measured_at: iso(f.now())
    }
  ])
  const before = f.ledger()
  recordUsageEvidence('codex', before)
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.ledger()).toEqual(before)
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('meters only the rollout records inside the window of each in-place Attempt', async () => {
  const boundary = usageStart + 1000
  const old = f.db.getWorkerDispatch(f.t01.attemptId)
  if (!old) {
    throw new Error('Missing dispatch')
  }
  f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
  f.db.settleWorkerStop(f.t01.attemptId)
  f.db.updateTaskStatus(f.t01.taskId, 'ready')
  const next = f.prepare(f.bind('T01'), 'codex', boundary)
  f.prepared(next.attemptId, { originSeq: 1, fromSeq: 1 })
  f.events([{ type: 'thread.started', thread_id: usageThread }], next)
  f.db.db
    .prepare('UPDATE worker_dispatches SET updated_at = ? WHERE dispatch_id = ?')
    .run(iso(boundary), f.t01.attemptId)
  f.rollout(codexRecords())
  await f.tick()
  expect(f.ledger()).toMatchObject([
    {
      dispatch_id: f.t01.attemptId,
      seq: 1,
      new_tokens: 650,
      cached_input_tokens: 400,
      output_tokens: 50,
      final: 1,
      status: 'complete'
    },
    {
      dispatch_id: next.attemptId,
      seq: 2,
      new_tokens: 580,
      cached_input_tokens: 1500,
      output_tokens: 80,
      final: 0,
      status: 'complete'
    }
  ])
  recordUsageEvidence('in-place', {
    windows: [
      { start: iso(usageStart), endExclusive: iso(boundary) },
      { start: iso(boundary), endExclusive: null }
    ],
    rows: f.ledger()
  })
})

it('meters a running Claude Attempt from the largest usage of each message', async () => {
  f.prepare(f.t01, 'claude')
  f.events(claudeRecords())
  await f.tick()
  recordUsageEvidence('claude', f.ledger())
  expect(f.ledger()).toEqual([
    {
      dispatch_id: f.t01.attemptId,
      mission_id: f.mission.id,
      task_id: f.t01.taskId,
      seq: 1,
      provider: 'claude',
      new_tokens: 430,
      input_tokens: 30,
      cached_input_tokens: 2300,
      cache_write_tokens: 300,
      output_tokens: 100,
      reasoning_tokens: 0,
      status: 'complete',
      final: 0,
      measured_at: iso(f.now())
    }
  ])
})

it('finalizes an ended Attempt once with its whole window', async () => {
  const rollout = f.rollout([tokenRecord(usageStart)])
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 650, final: 0 }])
  expect(await f.submit()).toMatchObject({ ok: true })
  f.rollout(codexRecords())
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 1230, status: 'complete', final: 1 }])
  const final = f.ledger()
  appendFileSync(rollout, `${JSON.stringify(tokenRecord(usageStart + 3000, usageB))}\n`)
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.ledger()).toEqual(final)
})

it('finalizes an ended Attempt without a usage source as unavailable', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ agent: 'codex' }), f.t01.attemptId)
  expect(await f.submit()).toMatchObject({ ok: true })
  await f.tick()
  expect(f.ledger()).toMatchObject([
    {
      dispatch_id: f.t01.attemptId,
      new_tokens: 0,
      input_tokens: 0,
      cached_input_tokens: 0,
      cache_write_tokens: 0,
      output_tokens: 0,
      reasoning_tokens: 0,
      status: 'unavailable',
      final: 1
    }
  ])
})

it('writes nothing for a current Attempt without new tokens', async () => {
  const before = f.snapshot()
  await f.tick()
  expect(f.ledger()).toEqual([])
  expect(f.snapshot()).toEqual(before)
})

it('marks a reading partial when the rollout is cut or a usage record is unusable', async () => {
  f.rollout([tokenRecord(usageStart + 1)], `${'x'.repeat(32 * 1024 * 1024)}\n`)
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 650, status: 'partial' }])
  f.rollout([
    tokenRecord(usageStart),
    {
      timestamp: iso(usageStart + 1),
      type: 'event_msg',
      payload: { type: 'token_count', info: { total_token_usage: usageA } }
    }
  ])
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 650, status: 'partial' }])
})

it('keeps the measured numbers and no account field from the rollout', async () => {
  f.rollout(codexRecords())
  const before = f.store.listAuditEvents({ missionId: f.mission.id })
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 1230 }])
  const audits = f.store.listAuditEvents({ missionId: f.mission.id })
  expect(audits).toEqual(before)
  const serialized = JSON.stringify({ ledger: f.ledger(), audits })
  expect(serialized).not.toContain(usageDecoy)
  expect(JSON.stringify(f.ledger())).not.toContain(f.home)
  expect(JSON.stringify(f.ledger())).not.toContain(usageThread)
})

it('finalizes at most twenty ended Attempts per pass', async () => {
  const ended: string[] = []
  for (let index = 0; index < 22; index++) {
    const worker = index === 0 ? f.t01 : f.prepare(f.bind('T01'), 'codex', usageStart + index)
    ended.push(worker.attemptId)
    f.db.beginWorkerStop(worker.attemptId, f.runtime.getRuntimeId())
    f.db.settleWorkerStop(worker.attemptId)
    f.db.updateTaskStatus(worker.taskId, 'ready')
    f.store.updateTaskStage({ taskId: worker.taskId, from: 'RUNNING', to: 'READY' })
  }
  const current = f.prepare(f.bind('T01'), 'claude')
  f.events(claudeRecords(), current)
  await f.tick()
  expect(
    f
      .ledger()
      .filter((row) => row.final === 1)
      .map((row) => row.dispatch_id)
  ).toEqual(ended.slice(0, 20))
  expect(f.ledger()).toContainEqual(
    expect.objectContaining({ dispatch_id: current.attemptId, final: 0, new_tokens: 430 })
  )
  await f.tick()
  expect(f.ledger().filter((row) => row.final === 1)).toHaveLength(22)
})

it('keeps Claude zero readings complete and malformed usage partial', async () => {
  f.prepare(f.t01, 'claude')
  f.events([{ type: 'result', usage: { input_tokens: 9999 } }])
  expect(await f.submit()).toMatchObject({ ok: true })
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 0, status: 'complete', final: 1 }])
  const next = f.prepare(f.bind('T02'), 'claude')
  f.events(claudeRecords(), next)
  appendFileSync(
    path.join(f.root, next.attemptId, 'events.jsonl'),
    '{"type":"assistant","usage": broken}\n'
  )
  await f.tick()
  expect(f.ledger()).toContainEqual(
    expect.objectContaining({ dispatch_id: next.attemptId, new_tokens: 430, status: 'partial' })
  )
  writeFileSync(path.join(f.root, next.attemptId, 'events.jsonl'), '')
  await f.tick()
  expect(f.ledger()).toContainEqual(
    expect.objectContaining({ dispatch_id: next.attemptId, new_tokens: 430, status: 'partial' })
  )
})

it('defers finalization when a continuation changes the window during IO', async () => {
  f.rollout(codexRecords())
  f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
  f.db.settleWorkerStop(f.t01.attemptId)
  f.db.updateTaskStatus(f.t01.taskId, 'ready')
  f.store.updateTaskStage({ taskId: f.t01.taskId, from: 'RUNNING', to: 'READY' })
  const read = codexUsage.readCodexAttemptUsage
  const spy = vi
    .spyOn(codexUsage, 'readCodexAttemptUsage')
    .mockImplementationOnce(async (...args) => {
      const result = await read(...args)
      const next = f.prepare(f.bind('T01'), 'codex', usageStart + 1000)
      f.prepared(next.attemptId, { originSeq: 1, fromSeq: 1 })
      return result
    })
  await f.tick()
  expect(f.ledger()).toEqual([])
  spy.mockRestore()
  await f.tick()
  expect(f.ledger()).toMatchObject([
    { seq: 1, new_tokens: 650, final: 1 },
    { seq: 2, new_tokens: 580, final: 0 }
  ])
})

it('retries a failed finalization without exposing its error or stopping other readings', async () => {
  f.rollout(codexRecords())
  expect(await f.submit()).toMatchObject({ ok: true })
  const second = f.prepare(f.bind('T02'), 'claude')
  f.events(claudeRecords(), second)
  vi.spyOn(codexUsage, 'readCodexAttemptUsage').mockRejectedValueOnce(new Error(usageDecoy))
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
  await f.tick()
  expect(f.ledger()).toMatchObject([{ dispatch_id: second.attemptId, new_tokens: 430, final: 0 }])
  expect(warning).toHaveBeenCalledWith('[axiom] Attempt token metering deferred', {
    missionId: f.mission.id,
    taskId: f.t01.taskId,
    attemptId: f.t01.attemptId
  })
  expect(JSON.stringify(warning.mock.calls)).not.toContain(usageDecoy)
  await f.tick()
  expect(f.ledger()).toContainEqual(
    expect.objectContaining({ dispatch_id: f.t01.attemptId, new_tokens: 1230, final: 1 })
  )
})

it('marks Claude usage partial when the events file exceeds its read cap', async () => {
  f.prepare(f.t01, 'claude')
  f.events(claudeRecords())
  appendFileSync(path.join(f.root, f.t01.attemptId, 'events.jsonl'), ' '.repeat(64 * 1024 * 1024))
  await f.tick()
  expect(f.ledger()).toMatchObject([{ new_tokens: 430, status: 'partial', final: 0 }])
})
