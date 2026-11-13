import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  stallEvidenceFixture,
  evidenceNow,
  recordStallEvidence
} from './stall-evidence-fixture.test-support'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'

let f: ReturnType<typeof stallEvidenceFixture>
beforeEach(() => {
  f = stallEvidenceFixture()
})
afterEach(() => {
  f.cleanup()
})

it('reconciles an observation as a hit when the timeout rule stops the Attempt', async () => {
  const observation = f.observe()
  f.audit(observation.attemptId, 'attempt.stopped', { reason: 'timeout' }, '2026-11-12 12:00:00')
  await f.tick()
  expect(f.reconciled()).toMatchObject([
    {
      objectKind: 'attempt',
      objectId: observation.attemptId,
      actor: 'RecoveryService',
      after: {
        rule: 'stalled',
        mode: 'observe',
        taskId: f.task.taskId,
        seq: 1,
        observationSequence: observation.sequence,
        outcome: 'hit',
        endedBy: 'timeout',
        endedAt: '2026-11-12T12:00:00Z',
        savedMs: 120_000
      }
    }
  ])
  recordStallEvidence(
    'hit',
    f.audits().filter((row) => row.objectId === observation.attemptId)
  )
})

it('reconciles an observation as a false positive when the candidate passes verification', async () => {
  const observation = f.observe('notify')
  const submission = f.submit(observation.attemptId, ['FAIL', 'RUNNING', 'PASS'])
  await f.tick()
  expect(f.reconciled()).toMatchObject([
    {
      after: {
        mode: 'notify',
        observationSequence: observation.sequence,
        outcome: 'false_positive',
        endedBy: 'verification_pass',
        endedAt: exposeUtcTimestamp(submission.createdAt)
      }
    }
  ])
  expect(f.reconciled()[0]?.after).not.toHaveProperty('savedMs')
  recordStallEvidence(
    'false-positive',
    f.audits().filter((row) => row.objectId === observation.attemptId)
  )
})

it('reconciles an observation as a hit when verification fails', async () => {
  const observation = f.observe()
  const submission = f.submit(observation.attemptId, ['CANCELED', 'FAIL'])
  await f.tick()
  expect(f.reconciled()).toMatchObject([
    {
      after: {
        observationSequence: observation.sequence,
        outcome: 'hit',
        endedBy: 'verification_fail',
        endedAt: exposeUtcTimestamp(submission.createdAt),
        savedMs: expect.any(Number)
      }
    }
  ])
})

it('reconciles a failed ending as a hit and an interrupted ending as inconclusive', async () => {
  for (const kind of ['failed', 'unchanged', 'interrupted']) {
    const observation = f.observe()
    f.audit(observation.attemptId, 'attempt.failed', { reason: kind, settlement: { kind } })
  }
  await f.tick()
  expect(f.reconciled()).toMatchObject([
    { after: { outcome: 'hit', endedBy: 'failed', savedMs: 120_000 } },
    { after: { outcome: 'hit', endedBy: 'unchanged', savedMs: 120_000 } },
    { after: { outcome: 'inconclusive', endedBy: 'interrupted' } }
  ])
  expect(f.reconciled()[2]?.after).not.toHaveProperty('savedMs')
  recordStallEvidence(
    'inconclusive',
    f.audits().filter((row) => row.objectId === 'stall-attempt-3')
  )
})

it('reconciles declared and canceled endings as inconclusive', async () => {
  for (const kind of ['no_change', 'blocked']) {
    f.audit(f.observe().attemptId, 'attempt.failed', { settlement: { kind } })
  }
  for (const reason of ['stalled', 'kernel_stopped', 'mission_canceled']) {
    f.audit(f.observe().attemptId, 'attempt.stopped', { reason })
  }
  f.audit(f.observe().attemptId, 'attempt.abandoned', { reason: 'unverifiable' })
  f.submit(f.observe().attemptId, ['CANCELED', 'CANCELED'])
  f.observe()
  f.audit(f.observe().attemptId, 'attempt.stop_unknown', { reason: 'timeout' })
  await f.tick()
  expect(f.reconciled().map((row) => row.after)).toMatchObject([
    { outcome: 'inconclusive', endedBy: 'declared' },
    { outcome: 'inconclusive', endedBy: 'declared' },
    { outcome: 'inconclusive', endedBy: 'stopped' },
    { outcome: 'inconclusive', endedBy: 'stopped' },
    { outcome: 'inconclusive', endedBy: 'stopped' },
    { outcome: 'inconclusive', endedBy: 'abandoned' },
    { outcome: 'inconclusive', endedBy: 'canceled_runs' },
    { outcome: 'inconclusive', endedBy: 'unknown' },
    { outcome: 'inconclusive', endedBy: 'unknown' }
  ])
})

it('keeps an observation pending while its Attempt is current', async () => {
  f.observe()
  f.store.updateTaskStage({ taskId: f.task.taskId, from: f.task.stage, to: 'RUNNING' })
  await f.tick()
  expect(f.reconciled()).toEqual([])
})

it('keeps an observation pending while verification is under way', async () => {
  for (const status of [
    'QUEUED',
    'RUNNING',
    'INCONCLUSIVE',
    'SPECIALIST_REVIEW',
    'HUMAN_REVIEW'
  ] as const) {
    f.submit(f.observe().attemptId, ['FAIL', status])
  }
  await f.tick()
  expect(f.reconciled()).toEqual([])
})

it('reconciles each observation once', async () => {
  const observation = f.observe()
  f.submit(observation.attemptId, ['FAIL'])
  await f.tick()
  expect(f.reconciled()).toHaveLength(1)
  const before = f.reconciled()
  f.verification(observation.attemptId, 'PASS')
  f.setNow(evidenceNow + 60_000)
  await f.tick()
  expect(f.reconciled()).toEqual(before)
})

it('retries a failed audit independently and limits each pass to one hundred observations', async () => {
  f.samples(102)
  const append = f.store.appendAuditEvent.bind(f.store)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const spy = vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.supervision_reconciled' && input.objectId === 'stall-attempt-1') {
      throw new Error('Fixture audit failure')
    }
    return append(input)
  })
  await f.tick()
  expect(f.reconciled()).toHaveLength(99)
  expect(f.reconciled()[0]?.objectId).toBe('stall-attempt-2')
  expect(warn).toHaveBeenCalled()
  spy.mockRestore()
  await f.tick()
  expect(f.reconciled()).toHaveLength(102)
})

it('isolates a failed observation read and reconciles both modes independently', async () => {
  const first = f.observe()
  const second = f.observe('notify')
  f.audit(first.attemptId, 'attempt.stopped', { reason: 'timeout' })
  f.audit(second.attemptId, 'attempt.stopped', { reason: 'timeout' })
  const original = f.audits().find((row) => row.sequence === first.sequence)
  if (
    !original ||
    !original.after ||
    typeof original.after !== 'object' ||
    Array.isArray(original.after)
  ) {
    throw new Error('Missing observation payload')
  }
  const notify = f.audit(first.attemptId, 'attempt.supervised', {
    ...original.after,
    mode: 'notify'
  })
  const read = f.store.getUnreconciledStallObservation.bind(f.store)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const failedRead = vi
    .spyOn(f.store, 'getUnreconciledStallObservation')
    .mockImplementation((sequence) => {
      if (sequence === first.sequence) {
        throw new Error('Fixture read failure')
      }
      return read(sequence)
    })
  await f.tick()
  expect(f.reconciled()).toMatchObject([
    { after: { observationSequence: second.sequence, mode: 'notify' } },
    { after: { observationSequence: notify, mode: 'notify' } }
  ])
  failedRead.mockRestore()
  await f.tick()
  expect(f.reconciled()).toHaveLength(3)
  expect(f.reconciled().at(-1)?.after).toMatchObject({
    observationSequence: first.sequence,
    mode: 'observe'
  })
})

it('clamps savings at zero and leaves lifecycle rows unchanged', async () => {
  const observation = f.observe()
  f.audit(observation.attemptId, 'attempt.stopped', { reason: 'timeout' }, '2026-11-12T11:57:00Z')
  const snapshot = () =>
    ['task_stages', 'attempt_bindings', 'worker_dispatches', 'axiom_effects'].map((table) =>
      f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    )
  const before = snapshot()
  await f.tick()
  expect(f.reconciled()).toMatchObject([{ after: { outcome: 'hit', savedMs: 0 } }])
  expect(snapshot()).toEqual(before)
})
