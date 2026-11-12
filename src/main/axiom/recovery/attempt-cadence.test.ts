import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { supervisionFixture } from './supervision-fixture.test-support'

let f: Awaited<ReturnType<typeof supervisionFixture>>
beforeEach(async () => {
  f = await supervisionFixture()
  f.budget()
})
afterEach(async () => {
  await f.cleanup()
})

it('writes the cadence of an Attempt once after it stops being current', async () => {
  f.events(f.now() - 1000)
  await f.tick()
  f.setNow(f.now() + 60_000)
  await f.tick()
  f.events()
  f.setNow(f.now() + 60_000)
  await f.tick()
  expect(f.cadence()).toEqual([])
  f.budget(1)
  await f.tick()
  expect(f.cadence()).toMatchObject([
    {
      after: {
        taskId: f.t01.taskId,
        seq: 1,
        maxEventGapMs: 61_000,
        samples: 4,
        resolutionMs: 60_000,
        partial: false
      }
    }
  ])
  await f.tick()
  expect(f.cadence()).toHaveLength(1)
})

it('marks the cadence partial when sampling began after a restart', async () => {
  f.setNow(f.startedAt + 120_001)
  f.events()
  await f.tick()
  f.budget(1)
  await f.tick()
  expect(f.cadence()).toMatchObject([{ after: { partial: true, samples: 2 } }])
})

it('retains cadence for retry when its audit write fails', async () => {
  f.events()
  await f.tick()
  const append = f.store.appendAuditEvent.bind(f.store)
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  const write = vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.cadence') {
      throw new Error('Fixture cadence write failure')
    }
    return append(input)
  })
  f.budget(1)
  expect(await f.tick()).toMatchObject({ attempts: [{ action: 'stopped' }] })
  expect(f.cadence()).toEqual([])
  expect(warn).toHaveBeenCalled()
  write.mockRestore()
  await f.tick()
  expect(f.cadence()).toMatchObject([{ after: { samples: 2, maxEventGapMs: 0 } }])
  await f.tick()
  expect(f.cadence()).toHaveLength(1)
})

it('flushes cadence when its binding disappears', async () => {
  f.events()
  await f.tick()
  f.db.db.prepare('DELETE FROM attempt_bindings WHERE dispatch_id = ?').run(f.t01.attemptId)
  await f.tick()
  expect(f.cadence()).toMatchObject([{ objectId: f.t01.attemptId, after: { samples: 1 } }])
  await f.tick()
  expect(f.cadence()).toHaveLength(1)
})

it('flushes cadence after a Submission and preserves the verified candidate path', async () => {
  f.events()
  await f.tick()
  expect(await f.submit()).toMatchObject({ ok: true })
  const submission = f.store.getSubmissionByDispatch(f.t01.attemptId)
  await f.tick()
  expect(f.cadence()).toMatchObject([{ after: { samples: 1 } }])
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toEqual(submission)
  expect(f.stop).not.toHaveBeenCalled()
  await f.tick()
  expect(f.cadence()).toHaveLength(1)
})
