import './unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { channelFixture } from '../../axiom/execution/attempt-channel-fixture.test-support'
import { defineMethod, type RpcContext, type RpcRequest, type RpcResponse } from './core'
import { RpcDispatcher } from './dispatcher'
import type { RpcDispatchStreamingOptions } from './dispatcher-stream-options'
import type { OrchestrationCompatibilityEvidence } from '../../../shared/orchestration-compatibility-evidence'

let f: ReturnType<typeof channelFixture>
beforeEach(() => {
  f = channelFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

function terminalEvidence(): OrchestrationCompatibilityEvidence {
  return { terminalHandle: f.t01.from, paneKey: f.t01.paneKey, launchToken: 'fixture-launch' }
}
function request(method: string, evidence = terminalEvidence()): RpcRequest {
  const params = {
    'axiom.plan.approve': { planRevisionId: f.plan.id, resolver: 'worker' },
    'axiom.policy.update': { missionId: f.mission.id, patch: { concurrencyLimit: 7 } },
    'axiom.message.answer': {
      missionId: f.mission.id,
      questionId: 'q_does_not_exist',
      body: 'x'
    }
  }[method]
  return {
    id: method,
    authToken: 'test',
    method,
    params: params ?? {},
    orchestrationContractVersion: 1,
    orchestrationRequestId: `terminal-${method}`,
    orchestrationCompatibilityEvidence: evidence
  }
}
async function call(
  streaming: boolean,
  input: RpcRequest,
  options?: RpcDispatchStreamingOptions
): Promise<RpcResponse> {
  if (!streaming) {
    return f.dispatcher.dispatch(input, options)
  }
  const replies: string[] = []
  await f.dispatcher.dispatchStreaming(input, (reply) => replies.push(reply), options)
  return JSON.parse(replies[0]!)
}
const audits = () =>
  f.store
    .listAuditEvents({ missionId: f.mission.id })
    .filter((row) => row.event === 'authority.refused')
const methods = ['axiom.plan.approve', 'axiom.policy.update', 'axiom.message.answer']

describe.each([false, true])('PTY refusal attribution (streaming: %s)', (streaming) => {
  it('audits all three human-action refusals from terminal evidence without a session id', async () => {
    const plan = f.store.getPlanRevision(f.plan.id)
    const policy = f.store.getPolicy(f.mission.id)
    for (const method of methods) {
      expect(await call(streaming, request(method))).toMatchObject({
        ok: false,
        error: { code: 'caller_not_desktop' }
      })
    }
    expect(audits()).toHaveLength(3)
    for (const method of methods) {
      expect(audits()).toContainEqual(
        expect.objectContaining({
          missionId: f.mission.id,
          objectKind: 'task',
          objectId: f.t01.taskId,
          after: { method, callerKind: 'local-cli', attemptId: f.t01.attemptId }
        })
      )
    }
    expect(f.store.getPlanRevision(f.plan.id)).toEqual(plan)
    expect(f.store.getPolicy(f.mission.id)).toEqual(policy)
  })

  it('keeps desktop calls effective and audits a refused CLI replay before the receipt', async () => {
    const input = request('axiom.policy.update')
    const fingerprint = { authenticatedCallerFingerprint: 'same-receipt-owner' }
    expect(
      await call(streaming, input, { ...fingerprint, caller: { kind: 'desktop' } })
    ).toMatchObject({ ok: true })
    expect(f.store.getPolicy(f.mission.id)?.concurrencyLimit).toBe(7)
    expect(audits()).toEqual([])
    expect(await call(streaming, input, fingerprint)).toMatchObject({
      ok: false,
      error: { code: 'caller_not_desktop' }
    })
    expect(audits()).toMatchObject([
      { after: { method: input.method, callerKind: 'local-cli', attemptId: f.t01.attemptId } }
    ])
  })
})

it.each(['handle-only', 'pane-only', 'reminted-handle', 'no-recorded-incarnation'])(
  'reuses D73 terminal identity for %s',
  async (kind) => {
    const evidence = terminalEvidence()
    if (kind === 'handle-only') {
      delete evidence.paneKey
    }
    if (kind === 'pane-only') {
      delete evidence.terminalHandle
    }
    if (kind === 'reminted-handle') {
      evidence.terminalHandle = 'term_stale_handle'
    }
    if (kind === 'no-recorded-incarnation') {
      f.db.db
        .prepare('UPDATE dispatch_contexts SET process_incarnation = NULL WHERE id = ?')
        .run(f.t01.attemptId)
    }
    expect(await call(false, request('axiom.plan.approve', evidence))).toMatchObject({
      ok: false,
      error: { code: 'caller_not_desktop' }
    })
    expect(audits()).toMatchObject([{ after: { attemptId: f.t01.attemptId } }])
  }
)

it.each([
  'absent',
  'forged-handle',
  'unknown-pane',
  'cross-worker',
  'disconnected-pane',
  'changed-pane',
  'changed-process',
  'missing-process',
  'stopping',
  'settled',
  'newer-attempt',
  'binding-mismatch',
  'no-binding'
])('refuses without attribution for %s evidence or ownership', async (kind) => {
  let evidence = terminalEvidence()
  if (kind === 'absent') {
    evidence = {}
  }
  if (kind === 'forged-handle') {
    evidence = { terminalHandle: 'term_forged' }
  }
  if (kind === 'unknown-pane') {
    evidence.paneKey = 'unknown-pane'
  }
  if (kind === 'cross-worker') {
    evidence.paneKey = f.bind('T02').paneKey
  }
  if (kind === 'disconnected-pane') {
    vi.spyOn(f.runtime, 'getLiveTerminalPaneKey').mockReturnValue(null)
  }
  if (kind === 'changed-pane') {
    delete evidence.paneKey
    f.panes.set(f.t01.from, 'replacement-pane')
  }
  if (kind === 'changed-process') {
    f.processes.set(f.t01.from, 'replacement-process')
  }
  if (kind === 'missing-process') {
    f.processes.delete(f.t01.from)
  }
  if (kind === 'stopping') {
    f.db.beginWorkerStop(f.t01.attemptId, f.runtime.getRuntimeId())
  }
  if (kind === 'settled') {
    f.db.db
      .prepare("UPDATE dispatch_contexts SET status = 'completed' WHERE id = ?")
      .run(f.t01.attemptId)
  }
  if (kind === 'newer-attempt') {
    f.store.insertAttemptBinding({
      ...f.store.getAttemptBindingByDispatch(f.t01.attemptId)!,
      seq: 2,
      branch: `axiom/attempt/${f.t01.taskId}/2`,
      dispatchId: null
    })
  }
  if (kind === 'binding-mismatch') {
    const other = f.store
      .listTaskStages({ missionId: f.mission.id })
      .find((row) => row.spec.id === 'T02')!
    f.db.db
      .prepare('UPDATE attempt_bindings SET task_id = ? WHERE dispatch_id = ?')
      .run(other.taskId, f.t01.attemptId)
  }
  if (kind === 'no-binding') {
    f.db.db.prepare('DELETE FROM attempt_bindings WHERE dispatch_id = ?').run(f.t01.attemptId)
  }
  for (const method of methods) {
    const input = request(method, evidence)
    expect(await call(false, input)).toMatchObject({
      ok: false,
      error: { code: 'caller_not_desktop' }
    })
  }
  expect(audits()).toEqual([])
})

it('does not infer a calling Attempt from human-action params', async () => {
  const input = request('axiom.plan.approve', {})
  input.params = {
    planRevisionId: f.plan.id,
    resolver: 'worker',
    from: f.t01.from,
    attemptId: f.t01.attemptId
  }
  expect(await call(false, input)).toMatchObject({
    ok: false,
    error: { code: 'caller_not_desktop' }
  })
  expect(audits()).toEqual([])
})

it('leaves the second-layer admission unchanged for a PTY without a resolved session', async () => {
  const handler = vi.fn((_params: unknown, ctx: RpcContext) => ({
    session: ctx.orchestrationCaller ?? null
  }))
  const dispatcher = new RpcDispatcher({
    runtime: f.runtime,
    methods: ['agentSession.respondToApproval', 'orchestration.workerStart', 'test.admin'].map(
      (name) =>
        defineMethod({
          name,
          permission: name === 'test.admin' ? 'host-admin' : 'workspace',
          params: z.record(z.string(), z.unknown()),
          handler
        })
    )
  })
  for (const method of [
    'agentSession.respondToApproval',
    'orchestration.workerStart',
    'test.admin'
  ]) {
    const input = {
      ...request(method),
      params: { from: f.t01.from },
      orchestrationRequestId: undefined
    }
    const result = await dispatcher.dispatch(input)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, result: { session: null } })
  }
  expect(handler).toHaveBeenCalledTimes(3)
  expect(audits()).toEqual([])
})
