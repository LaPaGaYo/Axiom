import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { recoveryPreservationFixture } from './preservation-fixture.test-support'
import * as snapshots from '../execution/preserved-snapshot'
import * as files from '../execution/headless-attempt-files'
import { settleAttemptWithoutSubmission } from '../execution/attempt-settlement'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { attemptBaselineAudit, attemptBaselineRef } from '../execution/attempt-fix-launch'
import { previousAttemptSection } from '../context-builder/previous-attempt'
import { captureRecoveryAttempt } from './attempt-recovery-preservation'
import { readPreservedBaseline } from '../execution/preserved-baseline'

let f: Awaited<ReturnType<typeof recoveryPreservationFixture>>
beforeEach(async () => {
  f = await recoveryPreservationFixture()
})
afterEach(async () => {
  await f.cleanup()
})

const missingReason = 'The assigned worker terminal is no longer live after orchestration recovery.'
function restart(epoch: string | null = 'earlier-runtime') {
  f.db.db
    .prepare('UPDATE worker_dispatches SET runtime_epoch = ? WHERE dispatch_id = ?')
    .run(epoch, f.t01.attemptId)
}
function loseTerminal() {
  return f.db.reconcileMissingWorkerTerminal(f.t01.attemptId, missingReason)
}
function replaceFile(name: string, value: string | undefined | Error) {
  const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
  vi.mocked(files.readHeadlessFile).mockImplementation(async (directory, requested) => {
    if (requested !== name) {
      return read?.(directory, requested)
    }
    if (value instanceof Error) {
      throw value
    }
    return value
  })
}
function expectCounted() {
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(f.effect(1)).toBeUndefined()
  expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
  expect(snapshots.preserveAttemptWorktree).not.toHaveBeenCalled()
}

it('settles a headless Attempt lost with its daemon on restart as an interruption', async () => {
  restart()
  expect(loseTerminal()).toMatchObject({ state: 'abandoned', stage: 'terminal_missing' })
  const resource = f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)
  const dispatch = f.db.getDispatchContextById(f.t01.attemptId)
  const before = f.audits().length
  const preserve = snapshots.preserveAttemptWorktree
  const capture = vi
    .spyOn(snapshots, 'preserveAttemptWorktree')
    .mockImplementation(async (input) => {
      expect(f.db.db.isTransaction).toBe(false)
      expect(f.db.getWorkerDispatch(f.t01.attemptId)).toMatchObject({
        state: 'abandoned',
        stage: 'terminal_missing'
      })
      expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('RUNNING')
      expect(f.audits().slice(before)).toEqual([])
      return preserve(input)
    })
  const fail = vi.spyOn(f.db, 'failDispatch')
  const stop = vi.spyOn(f.db, 'beginWorkerStop')
  const abandon = vi.spyOn(f.db, 'abandonWorkerDispatch')
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
  expect(capture).toHaveBeenCalledTimes(1)
  expect(fail).not.toHaveBeenCalled()
  expect(stop).not.toHaveBeenCalled()
  expect(abandon).not.toHaveBeenCalled()
  expect(f.runtime.closeTerminal).not.toHaveBeenCalled()
  expect(f.releaseWorker).not.toHaveBeenCalled()
  expect(f.db.getWorkerTerminalResourceByOwner(f.t01.attemptId)).toEqual(resource)
  expect(f.db.getDispatchContextById(f.t01.attemptId)).toEqual(dispatch)
  const audits = f.audits().slice(before)
  expect(audits.map((row) => row.event)).toEqual([
    'attempt.failed',
    'attempt.preserved',
    'task.stage',
    'task.stage'
  ])
  expect(audits[0]).toMatchObject({
    actor: 'RecoveryService',
    objectKind: 'attempt',
    objectId: f.t01.attemptId,
    after: {
      taskId: f.t01.taskId,
      seq: 1,
      reason: 'terminal_missing',
      lastError: missingReason,
      failure: { class: 'unknown', retryable: true, source: 'absent' },
      evidence: 'runtime_restarted',
      settlement: { kind: 'interrupted' }
    }
  })
  expect(audits[2]?.after).toMatchObject({ stage: 'NEEDS_FIX', reason: 'interrupted' })
  expect(audits[3]?.after).toMatchObject({ stage: 'READY', reason: 'retry_after_interruption' })
  expect(f.recorded().result).toMatchObject({
    status: 'preserved',
    scopePaths: ['partial.ts'],
    secrets: []
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.effect(1)).toMatchObject({
    status: 'pending',
    key: `${f.t01.taskId}/1`,
    payload: { taskId: f.t01.taskId, seq: 1, chain: 1, failureClass: 'unknown' }
  })
  const created = Date.parse(
    f.binding.createdAt.replace(' ', 'T') + (f.binding.createdAt.endsWith('Z') ? '' : 'Z')
  )
  expect(f.effect(1)?.dueAt).toBe(new Date(created + 180_000).toISOString())
  const allAudits = f.audits()
  const effect = f.effect(1)
  await f.recovery.reconcileAttempts()
  expect(f.audits()).toEqual(allAudits)
  expect(f.effect(1)).toEqual(effect)
  expect(f.store.getTaskStage(f.t01.taskId)?.attemptCount).toBe(0)
})

it('settles a lost-daemon Attempt as an interruption when its worktree cannot be preserved', async () => {
  restart()
  loseTerminal()
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockResolvedValue({
    status: 'unavailable',
    reason: 'worktree_missing'
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
  expect(f.recorded().result).toEqual({ status: 'unavailable', reason: 'worktree_missing' })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.effect(1)).toMatchObject({ payload: { chain: 1, failureClass: 'unknown' } })
  expect(resolveAttemptBaseline(f.store, { taskId: f.t01.taskId, seq: 2 })).toMatchObject({
    kind: 'integration',
    notContinued: [{ reason: 'unavailable', detail: 'worktree_missing' }],
    skippedAttempts: [{ kind: 'interrupted', failureClass: 'unknown' }]
  })
})

it('writes nothing for a lost-daemon Attempt that another path settled during capture', async () => {
  restart()
  loseTerminal()
  const preserve = snapshots.preserveAttemptWorktree
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementation(async (input) => {
    const captured = await preserve(input)
    // An already-running counted recovery pass can commit while this pass awaits capture.
    settleAttemptWithoutSubmission(f, {
      ...f.binding,
      reason: 'attempt_abandoned',
      actor: 'RecoveryService'
    })
    return captured
  })
  const before = f.audits().length
  await f.recovery.reconcileAttempts()
  expect(
    f
      .audits()
      .slice(before)
      .map((row) => row.event)
  ).toEqual(['task.stage', 'task.stage'])
  expect(f.audits().slice(before)[0]?.after).toMatchObject({ reason: 'attempt_abandoned' })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 1 })
  expect(f.effect(1)).toBeUndefined()
})

it('keeps a same-runtime kernel terminal_missing ending on the counted path', async () => {
  loseTerminal()
  vi.spyOn(snapshots, 'preserveAttemptWorktree')
  await f.recovery.reconcileAttempts()
  expectCounted()
})
it('keeps an abandonment by Axiom on the counted path after a restart', async () => {
  restart()
  f.db.abandonWorkerDispatch(f.t01.attemptId, f.runtime.getRuntimeId(), 'RecoveryService')
  expect(f.db.getWorkerDispatch(f.t01.attemptId)?.stage).toBe('abandoned')
  vi.spyOn(snapshots, 'preserveAttemptWorktree')
  await f.recovery.reconcileAttempts()
  expectCounted()
})
it('keeps a pending stop lost with its daemon on the stopped path', async () => {
  f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
  restart()
  expect(loseTerminal()).toMatchObject({ state: 'stopped', stage: 'terminal_missing' })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'attempt_stopped' }]
  })
  expect(f.recorded().result.status).toBe('preserved')
  expect(f.audits().filter((row) => row.event === 'attempt.failed')).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.stopped')).toMatchObject([
    { after: { reason: 'kernel_stopped' } }
  ])
  expect(f.store.getTaskStage(f.t01.taskId)?.attemptCount).toBe(1)
  expect(f.effect(1)).toBeUndefined()
})
it('does not treat an Attempt that left an exit marker as lost with its daemon', async () => {
  restart()
  loseTerminal()
  replaceFile('exit-code', '-1\n')
  vi.spyOn(snapshots, 'preserveAttemptWorktree')
  await f.recovery.reconcileAttempts()
  expectCounted()
})
it('keeps a TUI Attempt lost with its daemon on the counted path', async () => {
  restart()
  f.db.db
    .prepare('UPDATE worker_dispatches SET start_options = ? WHERE dispatch_id = ?')
    .run('{}', f.t01.attemptId)
  loseTerminal()
  vi.spyOn(snapshots, 'preserveAttemptWorktree')
  await f.recovery.reconcileAttempts()
  expectCounted()
})

it('continues the next Attempt from the snapshot of an Attempt lost with its daemon', async () => {
  restart()
  loseTerminal()
  await f.recovery.reconcileAttempts()
  const baseline = resolveAttemptBaseline(f.store, { taskId: f.t01.taskId, seq: 2 })
  const commitSha = await f.repo.git(['rev-parse', f.ref])
  expect(attemptBaselineAudit(baseline)).toEqual({
    kind: 'snapshot',
    strategy: 'continued',
    reason: 'preserved_snapshot',
    previousSeq: 1,
    attemptId: f.t01.attemptId,
    commitSha
  })
  expect(attemptBaselineRef(baseline, f.mission.id)).toBe(commitSha)
  expect(await f.repo.git(['show', `${commitSha}:partial.ts`])).toBe('export const partial = true')
  expect(await readFile(path.join(f.repo.root, 'partial.ts'), 'utf8')).toBe(
    'export const partial = true\n'
  )
})
it('tells the next Attempt that its runtime restarted when its daemon was lost', async () => {
  const put = f.put.getMockImplementation()
  f.put.mockImplementation(async (input) => {
    if (!put) {
      throw new Error('Missing Artifact writer')
    }
    const meta = await put(input)
    vi.spyOn(f.plane.artifacts, 'read').mockResolvedValue({ meta, content: input.content })
    return meta
  })
  restart()
  loseTerminal()
  await f.recovery.reconcileAttempts()
  const baseline = resolveAttemptBaseline(f.store, { taskId: f.t01.taskId, seq: 2 })
  const { content } = await previousAttemptSection(f.store, f.plane.artifacts, baseline, 'headless')
  expect(content).toContain(
    'The runtime that started Attempt 1 restarted, and the Attempt process was gone afterwards.'
  )
  expect(content).toContain('partial.ts')
  expect(content).toContain('Partial work left for review')
  expect(content).not.toContain('interrupted by unknown')
  expect(content).not.toContain('was stopped')
  expect(content).not.toContain('Attempt 1 failed')
})

it('retries an uncertain exit marker read without capture or settlement', async () => {
  restart()
  loseTerminal()
  const before = f.audits()
  replaceFile('exit-code', Object.assign(new Error('unreadable'), { code: 'EACCES' }))
  vi.spyOn(snapshots, 'preserveAttemptWorktree')
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.audits()).toEqual(before)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.effect(1)).toBeUndefined()
  expect(snapshots.preserveAttemptWorktree).not.toHaveBeenCalled()
  replaceFile('exit-code', undefined)
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'interrupted' }]
  })
})
it('rolls back a lost-daemon settlement including its continuation effect', async () => {
  restart()
  loseTerminal()
  const before = f.audits()
  const enqueue = f.plane.effects.enqueue.bind(f.plane.effects)
  const crash = vi.spyOn(f.plane.effects, 'enqueue').mockImplementation((input) => {
    const result = enqueue(input)
    if (input.kind === 'attempt.continue') {
      throw new Error('crash after continuation insert')
    }
    return result
  })
  expect(await f.recovery.reconcileAttempts()).toMatchObject({
    attempts: [{ action: 'reconcile_failed' }]
  })
  expect(f.audits()).toEqual(before)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.effect(1)).toBeUndefined()
  const commitSha = await f.repo.git(['rev-parse', f.ref])
  crash.mockRestore()
  await f.recovery.reconcileAttempts()
  expect(f.recorded().result).toMatchObject({ status: 'preserved', snapshot: { commitSha } })
  expect(f.store.getTaskStage(f.t01.taskId)?.attemptCount).toBe(0)
})
it.each(['missing', 'unreadable', 'mismatched', 'capture-error'])(
  'interrupts without preservation after %s capture input',
  async (kind) => {
    restart(null)
    loseTerminal()
    if (kind === 'capture-error') {
      vi.spyOn(snapshots, 'preserveAttemptWorktree').mockRejectedValue(new Error('storage failure'))
    } else {
      replaceFile(
        'launch.json',
        kind === 'missing'
          ? undefined
          : kind === 'unreadable'
            ? new Error('unreadable')
            : JSON.stringify({ ...f.launch, branch: 'another-branch' })
      )
    }
    expect(await f.recovery.reconcileAttempts()).toMatchObject({
      attempts: [{ action: 'interrupted' }]
    })
    expect(f.audits().filter((row) => row.event === 'attempt.preserved')).toEqual([])
    expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  }
)
it.each(['', '1.5', '+1', ' 1', 'not-an-exit'])(
  'ignores an exit marker the exit path would reject: %s',
  async (marker) => {
    restart()
    loseTerminal()
    replaceFile('exit-code', marker)
    expect(await f.recovery.reconcileAttempts()).toMatchObject({
      attempts: [{ action: 'interrupted' }]
    })
  }
)

it('checks the kernel loss proof again before any capture IO', async () => {
  loseTerminal()
  const capture = vi.spyOn(snapshots, 'preserveAttemptWorktree')
  vi.mocked(files.readHeadlessFile).mockClear()
  expect(
    await captureRecoveryAttempt(
      {
        ...f,
        artifacts: f.plane.artifacts,
        now: Date.now
      },
      f.binding,
      'terminal_missing'
    )
  ).toBeUndefined()
  expect(files.readHeadlessFile).not.toHaveBeenCalled()
  expect(capture).not.toHaveBeenCalled()
})

it('respects Mission cancellation while lost-daemon capture is in flight', async () => {
  restart()
  loseTerminal()
  const preserve = snapshots.preserveAttemptWorktree
  vi.spyOn(snapshots, 'preserveAttemptWorktree').mockImplementation(async (input) => {
    const captured = await preserve(input)
    f.missions.cancelMission(f.mission.id, 'human')
    return captured
  })
  await f.recovery.reconcileAttempts()
  expect(f.store.getTaskStage(f.t01.taskId)?.stage).toBe('CANCELED')
  expect(
    f.audits().filter((row) => ['attempt.failed', 'attempt.preserved'].includes(row.event))
  ).toEqual([])
  expect(f.audits().filter((row) => row.event === 'attempt.abandoned')).toMatchObject([
    { after: { reason: 'mission_canceled' } }
  ])
  expect(f.effect(1)).toBeUndefined()
})

it('keeps restart evidence when a lost-daemon audit has a null last error', async () => {
  restart()
  loseTerminal()
  await f.recovery.reconcileAttempts()
  expect(
    readPreservedBaseline({
      taskId: f.t01.taskId,
      seq: 1,
      attemptId: f.t01.attemptId,
      audit: f.recorded(),
      failure: {
        reason: 'terminal_missing',
        lastError: null,
        evidence: 'runtime_restarted',
        settlement: { kind: 'interrupted' },
        failure: { class: 'unknown', retryable: true, source: 'absent' }
      },
      allowedPaths: ['**']
    })
  ).toMatchObject({
    usable: {
      ending: { kind: 'interrupted', failureClass: 'unknown', evidence: 'runtime_restarted' }
    }
  })
})
