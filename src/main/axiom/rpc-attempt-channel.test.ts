import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelFixture,
  subtask,
  workerVerbs,
  workerTypes
} from './execution/attempt-channel-fixture.test-support'
import { submissionFixture, report } from './execution/submission-fixture.test-support'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})

describe('axiom.attempt.submit authority and receipts', () => {
  let s: ReturnType<typeof submissionFixture>
  beforeEach(() => {
    s = submissionFixture()
  })
  afterEach(() => s.db.close())
  it.each([
    'missing-process',
    'other-process',
    'stale',
    'foreign',
    'process',
    'inactive',
    'unknown',
    'mismatch',
    'assignee'
  ] as const)(
    'rejects %s without any domain, observation, resource, message, audit or receipt change',
    async (reason) => {
      const p = s.params()
      if (reason === 'missing-process') {
        s.processes.delete(s.t01.from)
      }
      if (reason === 'other-process') {
        s.processes.set(s.t01.from, 'another-attempt-process')
      }
      if (reason === 'stale') {
        s.store.insertAttemptBinding({
          ...s.store.getAttemptBinding(s.t01.taskId, 1)!,
          seq: 2,
          branch: 'retry',
          dispatchId: null
        })
      }
      if (reason === 'foreign' || reason === 'assignee') {
        s.panes.set(s.t01.from, 'foreign-pane')
      }
      if (reason === 'process') {
        s.processes.set(s.t01.from, 'replacement')
      }
      if (reason === 'assignee') {
        s.db.db
          .prepare('UPDATE dispatch_contexts SET process_incarnation = NULL WHERE id = ?')
          .run(s.t01.attemptId)
      }
      if (reason === 'inactive') {
        s.db.settleWorkerReport({
          taskId: s.t01.taskId,
          dispatchId: s.t01.attemptId,
          outcome: 'succeeded',
          result: 'settled'
        })
      }
      if (reason === 'unknown') {
        p.attemptId = 'missing'
      }
      if (reason === 'mismatch') {
        s.db.db
          .prepare('UPDATE attempt_bindings SET mission_id = ? WHERE dispatch_id = ?')
          .run('other-process', p.attemptId)
      }
      const before = s.snapshot()
      const codes = {
        'missing-process': 'worker_identity_changed',
        'other-process': 'worker_identity_changed',
        stale: 'stale_dispatch',
        foreign: 'worker_identity_changed',
        process: 'worker_identity_changed',
        inactive: 'inactive_dispatch',
        unknown: 'unknown_dispatch',
        mismatch: 'task_dispatch_mismatch',
        assignee: 'sender_not_assignee'
      }
      expect(await s.call('axiom.attempt.submit', p)).toMatchObject({
        ok: false,
        error: { code: codes[reason] }
      })
      expect(s.snapshot()).toEqual(before)
      expect(s.db.db.prepare('SELECT request_id FROM mutation_receipts').all()).toEqual([])
      expect(s.snapshotGit).not.toHaveBeenCalled()
    }
  )
  it.each([
    { ...report, artifacts: ['unknown'] },
    { ...report, extra: true },
    { ...report, checksRun: [{ command: 'test', result: 'unknown' }] }
  ])('rejects an invalid report before snapshotting %#', async (invalid) => {
    const before = s.snapshot()
    expect(await s.call('axiom.attempt.submit', { ...s.params(), report: invalid })).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(s.snapshot()).toEqual(before)
    expect(s.snapshotGit).not.toHaveBeenCalled()
  })
  it('replays the recorded receipt after settlement and rejects changed intent', async () => {
    const envelope = {
      orchestrationRequestId: 'submit-retry'
    }
    expect(await s.call('axiom.attempt.submit', s.params(), envelope)).toMatchObject({
      ok: true,
      result: { duplicate: false }
    })
    const before = s.snapshot()
    expect(await s.call('axiom.attempt.submit', s.params(), envelope)).toMatchObject({
      ok: true,
      result: { duplicate: false, mutation: { replayed: true } }
    })
    expect(
      await s.call(
        'axiom.attempt.submit',
        { ...s.params(), report: { ...report, summary: 'changed' } },
        envelope
      )
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    expect(s.snapshot()).toEqual(before)
    expect(s.snapshotGit).toHaveBeenCalledTimes(1)
  })
  it('rejects a forged duplicate from another pane with no changes', async () => {
    expect(await s.submit()).toMatchObject({ ok: true })
    s.panes.set(s.t01.from, 'forged-pane')
    const before = s.snapshot()
    expect(await s.call('axiom.attempt.submit', s.params())).toMatchObject({
      ok: false,
      error: { code: 'worker_identity_changed' }
    })
    expect(s.snapshot()).toEqual(before)
  })
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

describe.each(workerVerbs)('axiom.attempt.%s', (verb) => {
  const params = () => ({
    attemptId: f.t01.attemptId,
    from: f.t01.from,
    summary: `${verb} evidence`,
    ...(verb === 'request-subtask' ? { subtask } : {})
  })
  const call = () => f.call(`axiom.attempt.${verb}`, params())
  it('persists exactly one typed Control Plane message and audits its recipients', async () => {
    const result = await call()
    expect(result).toMatchObject({ ok: true })
    const messages = f.db.getUnreadRunMailbox(f.mission.runId)
    expect(messages).toHaveLength(1)
    const type = workerTypes[workerVerbs.indexOf(verb)]
    expect(messages[0]).toMatchObject({
      from_handle: f.t01.from,
      to_handle: `run:${f.mission.runId}`,
      type: verb === 'inform' ? 'status' : verb === 'handoff' ? 'handoff' : 'escalation'
    })
    expect(JSON.parse(messages[0]!.payload!)).toEqual({
      axiom: {
        version: 1,
        type,
        missionId: f.mission.id,
        taskId: f.t01.taskId,
        attemptId: f.t01.attemptId,
        summary: `${verb} evidence`,
        artifactIds: [],
        related: {},
        ...(verb === 'request-subtask' ? { subtask } : {})
      }
    })
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: 'message.sent',
          objectId: messages[0]!.id,
          after: {
            type,
            taskId: f.t01.taskId,
            attemptId: f.t01.attemptId,
            recipients: [`run:${f.mission.runId}`]
          }
        })
      ])
    )
    expect(f.notify).toHaveBeenCalledWith(`run:${f.mission.runId}`, messages[0]!.type)
  })
  it.each(['missing-process', 'other-process', 'stale', 'foreign', 'inactive'] as const)(
    'rejects %s authority without messages, audit, stage or receipt changes',
    async (reason) => {
      if (reason === 'missing-process') {
        f.processes.delete(f.t01.from)
      }
      if (reason === 'other-process') {
        f.processes.set(f.t01.from, 'another-attempt-process')
      }
      if (reason === 'stale') {
        f.store.insertAttemptBinding({
          ...f.store.getAttemptBinding(f.t01.taskId, 1)!,
          seq: 2,
          dispatchId: null,
          branch: 'retry'
        })
      }
      if (reason === 'foreign') {
        f.panes.set(f.t01.from, 'foreign-pane')
      }
      if (reason === 'inactive') {
        f.db.settleWorkerReport({
          taskId: f.t01.taskId,
          dispatchId: f.t01.attemptId,
          outcome: 'succeeded',
          result: 'settled'
        })
      }
      const before = f.snapshot()
      const result = await f.call(`axiom.attempt.${verb}`, params())
      expect(result).toMatchObject({
        ok: false,
        error: {
          code:
            reason === 'stale'
              ? 'stale_dispatch'
              : reason === 'inactive'
                ? 'inactive_dispatch'
                : 'worker_identity_changed'
        }
      })
      expect(f.snapshot()).toEqual(before)
      expect(f.notify).not.toHaveBeenCalled()
    }
  )
  it('rejects sender_not_assignee without a recorded process incarnation', async () => {
    f.db.db
      .prepare('UPDATE dispatch_contexts SET process_incarnation = NULL WHERE id = ?')
      .run(f.t01.attemptId)
    f.panes.set(f.t01.from, 'foreign-pane')
    const before = f.snapshot()
    expect(await call()).toMatchObject({ ok: false, error: { code: 'sender_not_assignee' } })
    expect(f.snapshot()).toEqual(before)
  })
  it('replays a retry id once and refuses changed intent', async () => {
    const envelope = {
      orchestrationRequestId: `retry-${verb}`
    }
    const first = await f.call(`axiom.attempt.${verb}`, params(), envelope)
    expect(first.ok).toBe(true)
    const before = f.snapshot()
    expect(await f.call(`axiom.attempt.${verb}`, params(), envelope)).toMatchObject({
      ok: true,
      result: { mutation: { replayed: true } }
    })
    expect(f.snapshot()).toEqual(before)
    expect(
      await f.call(`axiom.attempt.${verb}`, { ...params(), summary: 'changed' }, envelope)
    ).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    expect(f.snapshot()).toEqual(before)
  })
})
