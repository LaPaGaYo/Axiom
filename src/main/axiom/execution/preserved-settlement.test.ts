import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { interruptionFixture } from './interruption-fixture.test-support'
import { submitExitedAttempt } from './attempt-exit-submission'
import { stopHeadlessAttemptWatchers } from './headless-attempt-watcher'
import * as preservation from './preserved-snapshot'
import { AttemptPreservedAuditSchema } from './preserved-snapshot-contract'
import { HandoffRecordsSchema } from './headless-handoff-records'

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
  vi.useRealTimers()
})
const snapshot = {
  ref: 'refs/axiom/preserved/t/1',
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40)
}
function audits() {
  return f.store.listAuditEvents({ missionId: f.mission.id })
}
function recorded() {
  return AttemptPreservedAuditSchema.parse(
    audits().find(({ event }) => event === 'attempt.preserved')?.after
  )
}

it('records why a worktree could not be preserved and settles as before', async () => {
  vi.spyOn(preservation, 'preserveAttemptWorktree').mockResolvedValue({
    status: 'unavailable',
    reason: 'worktree_missing'
  })
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(recorded()).toEqual({
    taskId: f.t01.taskId,
    baselineSha: 'c'.repeat(40),
    result: { status: 'unavailable', reason: 'worktree_missing' }
  })
  expect(f.effect(1)?.status).toBe('pending')
  expect(f.store.getSubmissionByDispatch(f.t01.attemptId)).toBeUndefined()
})

it.each(['interrupted', 'failed'] as const)(
  'preserves a %s exit and stores real records outside the settlement transaction',
  async (kind) => {
    const preserve = vi
      .spyOn(preservation, 'preserveAttemptWorktree')
      .mockImplementation(async () => {
        expect(f.db.db.isTransaction).toBe(false)
        return {
          status: 'preserved',
          snapshot,
          scopePaths: ['src/partial.ts'],
          secrets: [],
          changes: [{ path: 'src/partial.ts', status: 'added', added: 1, removed: 0 }]
        }
      })
    const put = f.put.getMockImplementation()
    f.put.mockImplementation(async (input) => {
      expect(f.db.db.isTransaction).toBe(false)
      if (!put) {
        throw new Error('fixture Artifact store missing')
      }
      return put(input)
    })
    f.setEvents([
      { type: 'item.completed', item: { type: 'agent_message', text: 'Parser partly written' } },
      {
        type: 'turn.failed',
        error: { message: kind === 'interrupted' ? 'Usage limit reached' : 'fixture work failed' }
      }
    ])
    expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe(kind)
    expect(preserve).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptId: f.t01.attemptId,
        taskId: f.t01.taskId,
        seq: 1,
        allowedPaths: expect.any(Array)
      })
    )
    const artifact = f.put.mock.calls.find(
      ([input]) => input.createdBy === 'AttemptSettlement'
    )?.[0]
    expect(artifact).toMatchObject({
      kind: 'log',
      mediaType: 'application/json',
      related: [f.t01.taskId, f.t01.attemptId]
    })
    expect(
      HandoffRecordsSchema.parse(JSON.parse(artifact?.content.toString() ?? ''))
    ).toMatchObject({ messages: ['Parser partly written'], changes: [{ path: 'src/partial.ts' }] })
    expect(recorded()).toEqual({
      taskId: f.t01.taskId,
      baselineSha: 'c'.repeat(40),
      artifactId: expect.any(String),
      result: { status: 'preserved', snapshot, scopePaths: ['src/partial.ts'], secrets: [] }
    })
    expect(
      audits()
        .filter(({ event }) => ['attempt.failed', 'attempt.preserved'].includes(event))
        .map(({ actor, objectId }) => ({ actor, objectId }))
    ).toEqual([
      { actor: 'AttemptSettlement', objectId: f.t01.attemptId },
      { actor: 'AttemptSettlement', objectId: f.t01.attemptId }
    ])
  }
)

it('settles despite an Artifact write failure and still audits the snapshot', async () => {
  vi.spyOn(preservation, 'preserveAttemptWorktree').mockResolvedValue({
    status: 'preserved',
    snapshot,
    scopePaths: [],
    secrets: [],
    changes: []
  })
  f.put.mockRejectedValue(new Error('private storage details'))
  expect(await submitExitedAttempt(f.runtime, f.t01.attemptId)).toBe('interrupted')
  expect(recorded()).not.toHaveProperty('artifactId')
  expect(recorded().result.status).toBe('preserved')
  expect(JSON.stringify(audits())).not.toContain('private storage details')
})

it('stores a records Artifact even when the worktree is empty', async () => {
  vi.spyOn(preservation, 'preserveAttemptWorktree').mockResolvedValue({ status: 'empty' })
  f.setEvents([
    { type: 'item.completed', item: { type: 'agent_message', text: 'No files changed yet' } },
    { type: 'turn.failed', error: { message: 'Usage limit reached' } }
  ])
  await submitExitedAttempt(f.runtime, f.t01.attemptId)
  expect(recorded()).toMatchObject({ result: { status: 'empty' }, artifactId: expect.any(String) })
})

it('refuses stale authority when another path settles during preservation', async () => {
  vi.spyOn(preservation, 'preserveAttemptWorktree').mockImplementation(async () => {
    f.db.failDispatch(f.t01.attemptId, 'Recovery observed exit', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    return { status: 'preserved', snapshot, scopePaths: [], secrets: [], changes: [] }
  })
  await expect(submitExitedAttempt(f.runtime, f.t01.attemptId)).rejects.toMatchObject({
    code: 'inactive_dispatch'
  })
  expect(
    audits().filter(({ event }) => ['attempt.failed', 'attempt.preserved'].includes(event))
  ).toEqual([])
})

it('rolls both audit rows back when the preservation audit cannot be written', async () => {
  vi.spyOn(preservation, 'preserveAttemptWorktree').mockResolvedValue({ status: 'empty' })
  const append = f.plane.store.appendAuditEvent.bind(f.plane.store)
  vi.spyOn(f.plane.store, 'appendAuditEvent').mockImplementation((input) => {
    if (input.event === 'attempt.preserved') {
      throw new Error('audit unavailable')
    }
    return append(input)
  })
  await expect(submitExitedAttempt(f.runtime, f.t01.attemptId)).rejects.toThrow('audit unavailable')
  expect(
    audits().filter(({ event }) => ['attempt.failed', 'attempt.preserved'].includes(event))
  ).toEqual([])
  expect(f.db.getDispatchContextById(f.t01.attemptId)?.status).toBe('dispatched')
})
