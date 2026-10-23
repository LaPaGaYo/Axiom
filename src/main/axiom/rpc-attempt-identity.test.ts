import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { submissionFixture } from './execution/submission-fixture.test-support'
import { subtask, workerVerbs } from './execution/attempt-channel-fixture.test-support'
import {
  SESSION_X,
  SESSION_Y,
  sessionRecord
} from '../runtime/rpc/orchestration-session-caller-test-fixture'
import {
  mintStructuredWorkerHandle,
  mintStructuredWorkerPaneKey,
  structuredWorkerIdentities,
  structuredWorkerProcessIncarnation
} from '../runtime/structured-worker-identity'

const hostRef = vi.hoisted((): { current: unknown } => ({ current: null }))
vi.mock('../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => hostRef.current
}))

let f: ReturnType<typeof submissionFixture>
beforeEach(() => {
  f = submissionFixture()
})
afterEach(() => {
  f.db.close()
  hostRef.current = null
  structuredWorkerIdentities.clear()
  vi.restoreAllMocks()
})

it.each(['submit', 'ask', ...workerVerbs])(
  '%s revalidates identity before returning a saved receipt',
  async (verb) => {
    const params =
      verb === 'submit'
        ? f.params()
        : {
            attemptId: f.t01.attemptId,
            from: f.t01.from,
            ...(verb === 'ask' ? { question: 'Format?', timeoutMs: 0 } : { summary: 'Evidence' }),
            ...(verb === 'request-subtask' ? { subtask } : {})
          }
    const envelope = { orchestrationRequestId: `retry-${verb}` }
    expect(await f.call(`axiom.attempt.${verb}`, params, envelope)).toMatchObject({ ok: true })
    f.processes.set(f.t01.from, 'another-incarnation')
    const before = f.snapshot()
    expect(await f.call(`axiom.attempt.${verb}`, params, envelope)).toMatchObject({
      ok: false,
      error: { code: 'worker_identity_changed' }
    })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each(['pane', 'process', 'unrecorded-process'])(
  'settled Submission replay refuses a changed %s with a new request id',
  async (changed) => {
    expect(await f.submit()).toMatchObject({ ok: true })
    if (changed === 'pane') {
      f.panes.set(f.t01.from, 'another-pane')
    }
    if (changed === 'process') {
      f.processes.set(f.t01.from, 'another-process')
    }
    if (changed === 'unrecorded-process') {
      f.db.db
        .prepare('UPDATE dispatch_contexts SET process_incarnation = NULL WHERE id = ?')
        .run(f.t01.attemptId)
    }
    const before = f.snapshot()
    expect(await f.submit()).toMatchObject({
      ok: false,
      error: { code: 'worker_identity_changed' }
    })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each(['submit', 'ask', 'check', ...workerVerbs])(
  '%s refuses another Attempt and a stopping Worker without effects',
  async (verb) => {
    const other = f.bind('T02')
    const params = {
      attemptId: f.t01.attemptId,
      from: other.from,
      ...(verb === 'submit'
        ? { report: f.params().report }
        : verb === 'ask'
          ? { question: 'Format?', timeoutMs: 0 }
          : verb === 'check'
            ? {}
            : { summary: 'Evidence' }),
      ...(verb === 'request-subtask' ? { subtask } : {})
    }
    const before = f.snapshot()
    expect(await f.call(`axiom.attempt.${verb}`, params)).toMatchObject({
      ok: false,
      error: { code: 'worker_identity_changed' }
    })
    expect(f.snapshot()).toEqual(before)
    f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
    const stopping = f.snapshot()
    expect(await f.call(`axiom.attempt.${verb}`, { ...params, from: f.t01.from })).toMatchObject({
      ok: false,
      error: { code: 'dispatch_inactive' }
    })
    expect(f.snapshot()).toEqual(stopping)
  }
)

it.each(['coordinator', 'worker'])(
  'refuses another %s terminal before replaying a saved receipt',
  async (party) => {
    const params = { attemptId: f.t01.attemptId, from: f.t01.from, summary: 'Evidence' }
    const envelope = { orchestrationRequestId: 'receipt' }
    expect(await f.call('axiom.attempt.inform', params, envelope)).toMatchObject({ ok: true })
    const other = party === 'worker' ? f.bind('T02') : { from: 'term_coord', paneKey: 'coord-pane' }
    f.panes.set(other.from, other.paneKey)
    if (party === 'coordinator') {
      f.db.createRun({
        coordinatorHandle: other.from,
        coordinatorPaneKey: other.paneKey,
        objective: 'Other Run'
      })
    }
    const before = f.snapshot()
    expect(
      await f.call('axiom.attempt.inform', params, {
        ...envelope,
        orchestrationCompatibilityEvidence: { terminalHandle: other.from, paneKey: other.paneKey }
      })
    ).toMatchObject({ ok: false, error: { code: 'consumer_fenced' } })
    expect(f.snapshot()).toEqual(before)
  }
)

it.each(['submit', 'ask', 'check', ...workerVerbs])(
  '%s uses the host-resolved structured Worker session',
  async (verb) => {
    const handle = mintStructuredWorkerHandle()
    const paneKey = mintStructuredWorkerPaneKey(SESSION_Y)
    const processIncarnation = structuredWorkerProcessIncarnation(SESSION_Y)
    structuredWorkerIdentities.register({
      handle,
      paneKey,
      processIncarnation,
      sessionId: SESSION_Y,
      agent: 'claude',
      worktreeId: 'repo::T02',
      hostScope: { kind: 'local', hostId: 'local' }
    })
    const records = new Map([
      [SESSION_X, sessionRecord(SESSION_X)],
      [SESSION_Y, sessionRecord(SESSION_Y)]
    ])
    hostRef.current = {
      deps: {
        store: {
          getRecord: (id: string) =>
            [...records.values()].find((record) => record.sessionId === id) ?? null,
          listRecords: () => [...records.values()]
        }
      }
    }
    vi.spyOn(f.runtime, 'ensureStructuredAgentSessionHost').mockResolvedValue()
    const worker = f.bind('T02', { from: handle, paneKey, processIncarnation })
    expect(f.db.getDispatchContextById(worker.attemptId)?.assignee_orca_session_id).toBe(SESSION_Y)
    const params = {
      attemptId: worker.attemptId,
      ...(verb === 'submit'
        ? { report: f.params().report }
        : verb === 'ask'
          ? { question: 'Format?', timeoutMs: 0 }
          : verb === 'check'
            ? {}
            : { summary: 'Evidence' }),
      ...(verb === 'request-subtask' ? { subtask } : {})
    }
    const wrong = await f.call(
      `axiom.attempt.${verb}`,
      { ...params, from: handle },
      {
        orchestrationCompatibilityEvidence: { agentSessionId: SESSION_X }
      }
    )
    expect(wrong).toMatchObject({ ok: false, error: { code: 'consumer_fenced' } })
    expect(
      await f.call(`axiom.attempt.${verb}`, params, {
        orchestrationCompatibilityEvidence: { agentSessionId: SESSION_Y }
      })
    ).toMatchObject({ ok: true })
  }
)
