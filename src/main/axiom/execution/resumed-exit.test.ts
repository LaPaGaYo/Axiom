import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { interruptionFixture, interruptionNow } from './interruption-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from './headless-attempt-watcher'
import * as rollout from './codex-rollout-limit'
import * as files from './headless-attempt-files'
import * as git from '../../git/runner'
import { report } from './submission-fixture.test-support'

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
function resumed(id: string, fromSeq: number) {
  f.store.appendAuditEvent({
    missionId: f.mission.id,
    actor: 'AttemptLauncher',
    event: 'attempt.headless_prepared',
    objectKind: 'attempt',
    objectId: id,
    before: null,
    after: {
      session: { strategy: 'resumed_in_place', id: 'thread-1', originSeq: 1, fromSeq },
      combination: { effective: { codexHome: { kind: 'account', path: '/test/account' } } }
    }
  })
}
const failed = (id: string) =>
  f.store
    .listAuditEvents({ missionId: f.mission.id })
    .findLast((row) => row.event === 'attempt.failed' && row.objectId === id)?.after

it('settles a refused resume at once without counting it toward the interruption chain', async () => {
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  const id = f.next()
  resumed(id, 1)
  f.setEvents([])
  f.setExit('1')
  expect(await submitExitedAttempt(f.runtime, id)).toBe('interrupted')
  expect(failed(id)).toMatchObject({
    reason: 'resume_refused',
    evidence: 'exit_code',
    exitCode: 1,
    settlement: { kind: 'interrupted' },
    failure: { class: 'unknown', retryable: true, source: 'absent' },
    sessionContinued: false,
    usageScope: 'session'
  })
  expect(f.effect(2)).toMatchObject({
    dueAt: new Date(interruptionNow).toISOString(),
    payload: { chain: 1 }
  })
  expect(f.store.getTaskStage(f.t01.taskId)).toMatchObject({ stage: 'READY', attemptCount: 0 })
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({ event: 'attempt.preserved', objectId: id })
  )
  const before = f.snapshot()
  expect(await submitExitedAttempt(f.runtime, id)).toBe('unchanged')
  expect(f.snapshot()).toEqual(before)
})
it.each(['0', '-9', '75'])(
  'refunds a refusal with exit code %s and no previous continuation effect as chain one',
  async (exit) => {
    resumed(f.t01.attemptId, 1)
    f.setEvents([{ type: 'turn.failed', error: { message: 'fixture work failed' } }])
    f.setExit(exit)
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
    expect(failed(f.t01.attemptId)).toMatchObject({
      reason: 'resume_refused',
      exitCode: Number(exit)
    })
    expect(f.effect(1)).toMatchObject({
      dueAt: new Date(interruptionNow).toISOString(),
      payload: { chain: 1 }
    })
  }
)
it('does not classify an accepted session failure as a refused resume', async () => {
  resumed(f.t01.attemptId, 1)
  f.setEvents([
    { type: 'thread.started', thread_id: 'different' },
    { type: 'turn.failed', error: { message: 'fixture work failed' } }
  ])
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('failed')
  expect(failed(f.t01.attemptId)).toMatchObject({
    reason: 'process_exited',
    sessionContinued: false,
    usageScope: 'session'
  })
})
it('marks the usage of a resumed Attempt as session totals', async () => {
  resumed(f.t01.attemptId, 1)
  f.setEvents([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.completed', usage: { input_tokens: 900, output_tokens: 100 } }
  ])
  f.setExit('0')
  const read = vi.mocked(files.readHeadlessFile).getMockImplementation()
  if (!read) {
    throw new Error('Missing fixture reader')
  }
  const { filesChanged: _files, ...payload } = report
  vi.mocked(files.readHeadlessFile).mockImplementation((dir, name) =>
    name === 'last-message.md'
      ? Promise.resolve(`\`\`\`json\n${JSON.stringify(payload)}\n\`\`\``)
      : read(dir, name)
  )
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: 'code.txt\0', stderr: '' })
  vi.spyOn(files, 'ingestHeadlessArtifacts').mockResolvedValue([])
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('submitted')
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toContainEqual(
    expect.objectContaining({
      event: 'attempt.submitted',
      after: expect.objectContaining({
        sessionContinued: true,
        usageScope: 'session',
        usage: { input_tokens: 900, output_tokens: 100 }
      })
    })
  )
})
it('looks for the rollout of a resumed session from the day the session began', async () => {
  f.db.db
    .prepare('UPDATE worker_dispatches SET created_at = ? WHERE dispatch_id = ?')
    .run('2026-11-03 12:00:00', f.t01.attemptId)
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  const id = f.next()
  resumed(id, 1)
  f.setEvents([
    { type: 'thread.started', thread_id: 'thread-1' },
    { type: 'turn.failed', error: { message: 'Usage limit reached' } }
  ])
  const read = vi.spyOn(rollout, 'readCodexRolloutLimit').mockResolvedValue(undefined)
  expect(await submitExitedAttempt(f.runtime, id)).toBe('interrupted')
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({ threadId: 'thread-1', startedAt: Date.parse('2026-11-03T12:00:00Z') })
  )
  expect(f.effect(2)?.payload).toMatchObject({ chain: 2 })
})
