import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  interruptionFixture,
  interruptionNow,
  claudeInterruptionEvents
} from './interruption-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from './headless-attempt-watcher'
import * as e2e from '../../e2e-config'
import * as files from './headless-attempt-files'

let f: ReturnType<typeof interruptionFixture>
beforeEach(() => {
  f = interruptionFixture()
})
afterEach(async () => {
  stopHeadlessAttemptWatchers(f.runtime)
  await f.plane.effects.stop()
  vi.clearAllTimers()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

it('does not consume the retry budget when an Attempt is interrupted', async () => {
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.store.nextAttemptSeq(f.t01.taskId)).toBe(2)
  expect(f.effect(1)).toMatchObject({
    status: 'pending',
    dueAt: '2026-11-09T12:01:00.000Z',
    payload: { taskId: f.t01.taskId, seq: 1, chain: 1, failureClass: 'usage_limit' }
  })
  const before = f.snapshot()
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('unchanged')
  expect(f.snapshot()).toEqual(before)
})
it.each(['codex', 'claude'])(
  'classifies the terminal %s events only after observing the exit marker',
  async (provider) => {
    f.prepare(f.t01.attemptId, provider)
    const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
    if (!read) {
      throw new Error('Missing scratch-file reader')
    }
    let exited = false
    vi.mocked(files.readHeadlessFile).mockImplementation(async (directory, name) => {
      if (name === 'exit-code') {
        exited = true
      }
      if (name === 'events.jsonl') {
        return (
          exited
            ? provider === 'claude'
              ? claudeInterruptionEvents()
              : [{ type: 'turn.failed', error: { message: 'Usage limit reached' } }]
            : [{ type: 'thread.started', thread_id: 'incomplete' }]
        )
          .map((event) => JSON.stringify(event))
          .join('\n')
      }
      return read(directory, name)
    })
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
    expect(f.effect(1)?.payload).toMatchObject({ failureClass: 'usage_limit' })
  }
)
it('rolls back the dispatch failure and refund if continuation persistence fails', async () => {
  vi.spyOn(f.plane.effects, 'enqueue').mockImplementation(() => {
    throw new Error('effect unavailable')
  })
  await expect(submitExitedAttempt(f.runtime, f.t01.attemptId)).rejects.toThrow(
    'effect unavailable'
  )
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('dispatched')
  expect(f.effect(1)).toBeUndefined()
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((event) => event.event === 'attempt.failed')
  ).toEqual([])
})
it('rejects a Worker-sent BLOCKED with reason environment', async () => {
  const response = await f.call('axiom.attempt.blocked', {
    attemptId: f.t01.attemptId,
    from: f.t01.from,
    summary: 'Please refund this Attempt',
    blocked: { reason: 'environment', paths: [] }
  })
  expect('error' in response).toBe(true)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 1 })
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toEqual([])
})

it.each([false, true])(
  'records the Claude stub audit and continuation at its structured reset (e2e=%s)',
  async (enabled) => {
    vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled })
    vi.stubEnv('AXIOM_E2E_INTERRUPTION_BACKOFF_MS', '100,200,300')
    f.prepare(f.t01.attemptId, 'claude')
    f.setEvents(claudeInterruptionEvents())
    f.setExit('75')
    await submitExitedAttempt(f.runtime, f.t01.attemptId)
    const audit = f.store
      .listAuditEvents({ missionId: f.mission.id })
      .find((event) => event.event === 'attempt.failed')
    expect(audit?.after).toEqual({
      taskId: f.t01.taskId,
      reason: 'process_exited',
      evidence: 'exit_code',
      exitCode: 75,
      settlement: { kind: 'interrupted' },
      failure: {
        class: 'usage_limit',
        retryable: true,
        source: 'structured',
        resetsAt: '2026-11-09T12:00:08.000Z',
        window: 'session'
      },
      lastError: 'Fixture usage limit reached',
      lastErrorEvent: { type: 'error_during_execution', message: 'Fixture usage limit reached' },
      lastMessageExcerpt: '',
      providerSessionId: 'fixture-attempt-1'
    })
    expect(f.effect(1)).toMatchObject({
      dueAt: enabled ? '2026-11-09T12:00:08.000Z' : '2026-11-09T12:01:08.000Z',
      status: 'pending',
      attempts: 0,
      payload: {
        taskId: f.t01.taskId,
        seq: 1,
        chain: 1,
        failureClass: 'usage_limit',
        resetsAt: '2026-11-09T12:00:08.000Z'
      }
    })
    console.info('M3-06-2a Claude audit:', JSON.stringify(audit))
    console.info('M3-06-2a Claude effect:', JSON.stringify(f.effect(1)))
  }
)

it('blocks the Task for the environment after three consecutive interruptions', async () => {
  for (let seq = 1; seq <= 3; seq++) {
    await submitExitedAttempt(f.runtime, seq === 1 ? f.t01.attemptId : f.next())
    expect(f.store.getTaskStage(f.t01.taskId)?.attemptCount).toBe(0)
  }
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({
    stage: 'BLOCKED',
    previousStage: 'NEEDS_FIX',
    attemptCount: 0
  })
  expect(f.effect(2)).toMatchObject({ payload: { chain: 2 }, dueAt: '2026-11-09T12:05:00.000Z' })
  expect(f.effect(3)).toBeUndefined()
  expect(
    f.store.listMessages({ missionId: f.mission.id, type: 'BLOCKED', pendingOnly: true })
  ).toMatchObject([
    {
      taskId: f.t01.taskId,
      blocked: { reason: 'environment', paths: [] },
      summary: expect.stringMatching(/usage_limit.*3/)
    }
  ])
  f.missions.startExecution(f.mission.id)
  const response = await f.call('axiom.task.adjust', {
    taskId: f.t01.taskId,
    rationale: 'Quota restored'
  })
  expect('error' in response).toBe(false)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(
    f.store.listMessages({ missionId: f.mission.id, type: 'BLOCKED', pendingOnly: true })
  ).toEqual([])
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({ event: 'blocked.resolved', actor: 'user' })
  )
})

it('blocks at once when the interruption cannot be retried', async () => {
  f.prepare(f.t01.attemptId, 'claude')
  f.setEvents([{ type: 'assistant', error: 'authentication_failed' }])
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'BLOCKED', attemptCount: 0 })
  expect(f.effect(1)).toBeUndefined()
  expect(f.store.listMessages({ missionId: f.mission.id, pendingOnly: true })).toMatchObject([
    { blocked: { reason: 'environment', paths: [] } }
  ])
})

it.each(['done', 'retired'] as const)(
  'counts a %s predecessor in the interruption chain',
  async (status) => {
    await submitExitedAttempt(f.runtime, f.t01.attemptId)
    const effect = f.effect(1)
    if (!effect) {
      throw new Error('Missing continuation')
    }
    const fence = {
      id: effect.id,
      expectedStatus: effect.status,
      expectedLeaseEpoch: effect.leaseEpoch
    }
    if (status === 'done') {
      f.store.completeEffect(fence)
    } else {
      f.store.retireEffect({ ...fence, reason: 'superseded_by_task_adjust' })
    }
    await submitExitedAttempt(f.runtime, f.next())
    expect(f.effect(2)?.payload).toMatchObject({ chain: 2 })
  }
)

it('retires a pending continuation when a person adjusts the Task', async () => {
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  f.missions.startExecution(f.mission.id)
  await f.call('axiom.task.adjust', { taskId: f.t01.taskId, rationale: 'Continue now' })
  expect(f.effect(1)).toMatchObject({ status: 'retired' })
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      actor: 'EffectOutbox',
      event: 'effect.retired',
      after: {
        kind: 'attempt.continue',
        key: `${f.t01.taskId}/1`,
        reason: 'superseded_by_task_adjust'
      }
    })
  )
})
it('rolls back continuation retirement when task adjustment rolls back', async () => {
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  f.missions.startExecution(f.mission.id)
  const before = f.effect(1)
  const append = f.plane.store.appendAuditEvent.bind(f.plane.store)
  vi.spyOn(f.plane.store, 'appendAuditEvent').mockImplementation((event) => {
    if (event.event === 'task.adjusted') {
      throw new Error('audit unavailable')
    }
    return append(event)
  })
  const response = await f.call('axiom.task.adjust', {
    taskId: f.t01.taskId,
    rationale: 'Continue now'
  })
  expect('error' in response).toBe(true)
  expect(f.effect(1)).toEqual(before)
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((event) => event.event === 'effect.retired')
  ).toEqual([])
})

it.each([true, false])(
  'honors the backoff seam only in e2e configuration (%s)',
  async (enabled) => {
    vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled })
    vi.stubEnv('AXIOM_E2E_INTERRUPTION_BACKOFF_MS', '100,200,300')
    await submitExitedAttempt(f.runtime, f.t01.attemptId)
    expect(f.effect(1)?.dueAt).toBe(
      new Date(interruptionNow + (enabled ? 100 : 60000)).toISOString()
    )
  }
)
