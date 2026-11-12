import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { createInput } from '../mission-controller/controller-fixture.test-support'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SupervisionShowResponse, type StallMode } from '../../../shared/axiom-contract/supervision'
import { supervisionFixture } from './supervision-fixture.test-support'

let f: Awaited<ReturnType<typeof supervisionFixture>>
beforeEach(async () => {
  f = await supervisionFixture()
  f.budget()
  f.e2e(true)
  vi.stubEnv('AXIOM_E2E_STALL_THRESHOLD_MS', '1000')
  f.events(f.now() - 2000)
})
afterEach(async () => {
  await f.cleanup()
})
function mode(value: StallMode, missionId: string | undefined = f.mission.id) {
  f.store.appendSupervisionSetting({
    rule: 'stalled',
    missionId,
    mode: value,
    actor: 'user',
    provenance: { kind: 'user' }
  })
}
async function show(missionId?: string) {
  const response = await f.call('axiom.supervision.show', { missionId })
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return SupervisionShowResponse.parse(response.result)
}

it('notifies once for a silent headless Attempt in notify mode without changing its state', async () => {
  mode('notify')
  const before = f.snapshot().filter(({ name }) => name !== 'audit_events')
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'unchanged' }]
  })
  expect(f.rule('stalled')).toMatchObject([
    {
      after: {
        rule: 'stalled',
        mode: 'notify',
        thresholdMs: 1000,
        thresholdSource: 'e2e',
        idleMs: 2000,
        lastEventAt: new Date(f.now() - 2000).toISOString(),
        wouldActAt: new Date(f.now() - 1000).toISOString()
      }
    }
  ])
  expect(f.snapshot().filter(({ name }) => name !== 'audit_events')).toEqual(before)
  f.events()
  await f.tick()
  f.setNow(f.now() + 3000)
  await f.tick()
  expect(f.rule('stalled')).toHaveLength(1)
  expect(f.stop).not.toHaveBeenCalled()
})

it('lists a stall notification while its Attempt is current', async () => {
  mode('notify')
  await f.tick()
  const view = await show(f.mission.id)
  const empty = {
    hits: 0,
    falsePositives: 0,
    known: 0,
    inconclusive: 0,
    hitRate: null,
    savedMs: 0,
    sinceSequence: 0,
    throughSequence: 0
  }
  expect(view).toEqual({
    rules: [
      {
        rule: 'stalled',
        globalMode: 'observe',
        globalSource: 'built_in',
        missionMode: 'notify',
        effectiveMode: 'notify'
      }
    ],
    notifications: [
      {
        missionId: f.mission.id,
        taskId: f.t01.taskId,
        seq: 1,
        attemptId: f.t01.attemptId,
        idleMs: 2000,
        thresholdMs: 1000,
        thresholdSource: 'e2e',
        lastEventAt: new Date(f.now() - 2000).toISOString(),
        notifiedAt: new Date(f.now()).toISOString()
      }
    ],
    evidence: [{ rule: 'stalled', window: empty, total: empty }],
    proposals: []
  })
  expect((await show()).notifications).toEqual(view.notifications)
  f.events()
  await f.tick()
  expect((await show()).notifications).toEqual(view.notifications)
  if (process.env.AXIOM_SUPERVISION_TEST_EVIDENCE === '1') {
    writeFileSync(
      path.join(
        process.env.AXIOM_SUPERVISION_EVIDENCE_DIRECTORY ?? '/tmp',
        'axiom-stall-notify.json'
      ),
      JSON.stringify({ audit: f.rule('stalled')[0], view }, null, 2)
    )
  }
  mode('stop')
  f.setNow(f.now() + 3000)
  await f.tick()
  expect((await show()).notifications).toEqual([])
  expect(f.rule('stalled')).toHaveLength(2)
})

it('stops a silent headless Attempt in stop mode under the stalled rule', async () => {
  mode('stop')
  expect(await f.recovery.reconcileAttempts()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.stop).toHaveBeenCalledExactlyOnceWith(f.runtime, f.t01.attemptId)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toMatchObject([
    { after: { reason: 'stalled' } }
  ])
  expect(f.recorded().result).toMatchObject({ status: 'preserved', scopePaths: ['partial.ts'] })
  expect(
    f.store
      .listEffects({ missionId: f.mission.id })
      .filter((row) => row.kind === 'attempt.continue')
  ).toEqual([])
  await f.tick()
  expect(f.stop).toHaveBeenCalledOnce()
})

it('records the stalled rule with its threshold and idle time in the stop settlement', async () => {
  mode('stop')
  const before = f.audits().length
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    {
      after: {
        taskId: f.t01.taskId,
        seq: 1,
        rule: 'stalled',
        mode: 'stop',
        action: 'stopped',
        thresholdMs: 1000,
        thresholdSource: 'e2e',
        idleMs: 2000,
        lastEventAt: new Date(f.now() - 2000).toISOString()
      }
    }
  ])
  const rows = f.audits().slice(before)
  expect(rows.map((row) => row.event)).toEqual([
    'attempt.supervised',
    'attempt.stopped',
    'attempt.preserved',
    'task.stage',
    'task.stage',
    'attempt.cadence'
  ])
  expect(rows.filter((row) => row.event === 'task.stage')).toMatchObject([
    { after: { stage: 'NEEDS_FIX', reason: 'stalled' } },
    { after: { stage: 'READY', reason: 'retry' } }
  ])
  if (process.env.AXIOM_SUPERVISION_TEST_EVIDENCE === '1') {
    writeFileSync(
      path.join(
        process.env.AXIOM_SUPERVISION_EVIDENCE_DIRECTORY ?? '/tmp',
        'axiom-stall-stop.json'
      ),
      JSON.stringify(rows, null, 2)
    )
  }
})

it('records the stalled rule once when the stall stop is unconfirmed', async () => {
  mode('stop')
  f.receipt('stop_unknown')
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stop_unknown' }] })
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([
    { after: { rule: 'stalled', mode: 'stop', action: 'stop_unknown' } }
  ])
  expect(f.audits().filter((row) => row.event === 'attempt.stop_unknown')).toMatchObject([
    { after: { reason: 'stalled' } }
  ])
  expect(f.stop).toHaveBeenCalledOnce()
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
})

it('stops a stalled Attempt in stop mode after an earlier observation', async () => {
  await f.tick()
  expect(f.rule('stalled')).toMatchObject([{ after: { mode: 'observe' } }])
  mode('stop')
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.rule('stalled')).toMatchObject([
    { after: { mode: 'observe' } },
    { after: { mode: 'stop', action: 'stopped' } }
  ])
})

it('does not stop an Attempt in stop mode whose events keep arriving', async () => {
  mode('stop')
  for (let pass = 0; pass < 3; pass++) {
    f.setNow(f.now() + 60_000)
    f.events(f.now() - 100)
    await f.tick()
  }
  expect(f.rule('stalled')).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
})

it('applies the stall stop before the timeout rule in the same pass', async () => {
  mode('stop')
  f.budget(1)
  expect(await f.recovery.reconcileAttempts()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.rule('timeout')).toEqual([])
  expect(f.rule('stalled')).toMatchObject([{ after: { mode: 'stop' } }])
  expect(f.stop).toHaveBeenCalledOnce()
})

it('keeps TUI Attempts out of the stall tiers', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run(JSON.stringify({ agent: 'codex' }), f.t01.attemptId)
  vi.spyOn(f.runtime, 'confirmTerminalShellForeground').mockResolvedValue(false)
  for (const value of ['notify', 'stop'] as const) {
    mode(value)
    await f.tick()
  }
  expect(f.rule('stalled')).toEqual([])
  expect(f.cadence()).toEqual([])
  expect(f.stop).not.toHaveBeenCalled()
})

it('deduplicates observations and notifications separately across mode changes', async () => {
  await f.tick()
  for (const value of ['notify', 'observe', 'notify'] as const) {
    mode(value)
    await f.tick()
  }
  expect(f.rule('stalled')).toMatchObject([
    { after: { mode: 'observe' } },
    { after: { mode: 'notify' } }
  ])
  expect((await show()).notifications).toHaveLength(1)
})

it('reads the changed global stall mode on the next pass without an override', async () => {
  await f.tick()
  f.store.appendSupervisionSetting({ rule: 'stalled', mode: 'notify', actor: 'user' })
  await f.tick()
  f.store.appendSupervisionSetting({ rule: 'stalled', mode: 'stop', actor: 'user' })
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.rule('stalled')).toMatchObject([
    { after: { mode: 'observe' } },
    { after: { mode: 'notify' } },
    { after: { mode: 'stop' } }
  ])
})

it('keeps the strict stall threshold boundary in stop mode', async () => {
  mode('stop')
  f.events(f.now() - 1000)
  await f.tick()
  expect(f.stop).not.toHaveBeenCalled()
  f.setNow(f.now() + 1)
  await f.tick()
  expect(f.stop).toHaveBeenCalledOnce()
})

it('hides submitted notifications but retains their audit rows', async () => {
  mode('notify')
  await f.tick()
  expect((await show()).notifications).toHaveLength(1)
  expect(await f.submit()).toMatchObject({ ok: true })
  // Isolate the unsubmitted predicate from Task-stage filtering.
  f.db.db.prepare("UPDATE task_stages SET stage = 'RUNNING' WHERE task_id = ?").run(f.t01.taskId)
  expect((await show()).notifications).toEqual([])
  expect(f.rule('stalled')).toHaveLength(1)
})

it('hides a notification behind a newer unbound Attempt', async () => {
  mode('notify')
  await f.tick()
  expect((await show()).notifications).toHaveLength(1)
  f.store.insertAttemptBinding({
    ...f.binding,
    seq: 2,
    branch: `axiom/attempt/${f.t01.taskId}/2`,
    dispatchId: null
  })
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
  expect((await show()).notifications).toEqual([])
  expect(f.rule('stalled')).toHaveLength(1)
})

it('filters notifications to their Mission and lists the oldest first', async () => {
  mode('notify')
  await f.tick()
  f.setNow(f.now() + 60_000)
  const second = f.bind('T02')
  f.prepare(second.attemptId)
  await f.tick()
  const items = (await show()).notifications
  expect(items.map((item) => item.attemptId)).toEqual([f.t01.attemptId, second.attemptId])
  expect(items[0]?.notifiedAt).toBe(new Date(f.now() - 60_000).toISOString())
  expect(items[1]?.notifiedAt).toBe(new Date(f.now()).toISOString())
  const other = f.missions.createMission(createInput).mission
  expect((await show(other.id)).notifications).toEqual([])
  expect((await show(f.mission.id)).notifications).toEqual(items)
})
