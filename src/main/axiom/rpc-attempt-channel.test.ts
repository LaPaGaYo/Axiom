import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  channelFixture,
  subtask,
  workerVerbs,
  workerTypes
} from './execution/attempt-channel-fixture.test-support'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
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
  const call = (capability: string | undefined = f.t01.capability) =>
    f.call(`axiom.attempt.${verb}`, params(), { orchestrationCapability: capability })
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
  it.each(['missing', 'wrong', 'stale', 'foreign', 'inactive'] as const)(
    'rejects %s authority without messages, audit, stage or receipt changes',
    async (reason) => {
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
      const capability =
        reason === 'missing' ? undefined : reason === 'wrong' ? 'dcap_wrong' : f.t01.capability
      const result = await f.call(`axiom.attempt.${verb}`, params(), {
        orchestrationCapability: capability
      })
      expect(result).toMatchObject({
        ok: false,
        error: {
          code:
            reason === 'stale'
              ? 'stale_dispatch'
              : reason === 'inactive'
                ? 'inactive_dispatch'
                : 'dispatch_capability_invalid'
        }
      })
      expect(f.snapshot()).toEqual(before)
      expect(f.notify).not.toHaveBeenCalled()
    }
  )
  it('rejects sender_not_assignee after a successful capability verifier (defense in depth)', async () => {
    vi.spyOn(f.db, 'verifyDispatchCapability').mockReturnValue({ valid: true })
    f.panes.set(f.t01.from, 'foreign-pane')
    const before = f.snapshot()
    expect(await call()).toMatchObject({ ok: false, error: { code: 'sender_not_assignee' } })
    expect(f.snapshot()).toEqual(before)
  })
  it('replays a retry id once and refuses changed intent', async () => {
    const envelope = {
      orchestrationCapability: f.t01.capability,
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
