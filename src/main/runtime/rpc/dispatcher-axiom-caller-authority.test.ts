import './unused-default-rpc-methods.test-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { OrcaRuntimeService } from '../orca-runtime'
import { OrchestrationDb } from '../orchestration/db'
import { defineMethod, type RpcRequest, type RpcResponse } from './core'
import { RpcDispatcher } from './dispatcher'
import type { RpcDispatchStreamingOptions } from './dispatcher-stream-options'

const desktopMethods = [
  'mission.create',
  'mission.plan',
  'mission.start',
  'mission.pause',
  'mission.resume',
  'mission.cancel',
  'goal.propose',
  'goal.activate',
  'plan.approve',
  'plan.reject',
  'policy.update',
  'task.create',
  'task.cancel',
  'message.answer',
  'message.resolve',
  'plan.propose',
  'artifact.put'
].map((name) => `axiom.${name}`)
const readMethods = [
  'namespace.get',
  'artifact.read',
  'artifact.list',
  'attempt.show',
  'attempt.list',
  'goal.show',
  'message.list',
  'mission.show',
  'mission.list',
  'plan.show',
  'plan.list',
  'policy.show',
  'task.list',
  'task.show',
  'verification.show',
  'verification.list'
].map((name) => `axiom.${name}`)
const callers: { label: string; options: RpcDispatchStreamingOptions; allowed: boolean }[] = [
  { label: 'local-cli', options: { caller: { kind: 'local-cli' } }, allowed: false },
  { label: 'paired-device', options: { pairedDeviceId: 'device-1' }, allowed: false },
  { label: 'missing', options: { clientKind: 'runtime' }, allowed: false },
  { label: 'desktop', options: { caller: { kind: 'desktop' } }, allowed: true }
]
const databases: OrchestrationDb[] = []
afterEach(() => {
  databases.splice(0).forEach((db) => db.close())
  vi.restoreAllMocks()
})
function fixture() {
  const db = new OrchestrationDb(':memory:')
  databases.push(db)
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(db)
  const handler = vi.fn(() => ({ accepted: true }))
  const dispatcher = new RpcDispatcher({
    runtime,
    methods: [...desktopMethods, ...readMethods].map((name) =>
      defineMethod({
        name,
        permission: 'workspace',
        params: z.record(z.string(), z.unknown()),
        handler
      })
    )
  })
  return { dispatcher, handler }
}
async function call(
  dispatcher: RpcDispatcher,
  streaming: boolean,
  request: RpcRequest,
  options?: RpcDispatchStreamingOptions
): Promise<RpcResponse> {
  if (!streaming) {
    return dispatcher.dispatch(request, options)
  }
  const replies: string[] = []
  await dispatcher.dispatchStreaming(request, (reply) => replies.push(reply), options)
  return JSON.parse(replies[0]!)
}
const request = (method: string): RpcRequest => ({
  id: method,
  authToken: 'test',
  method,
  params: {},
  orchestrationContractVersion: 1,
  orchestrationRequestId: `request-${method}`
})

describe.each([false, true])('D78 unary authority (streaming: %s)', (streaming) => {
  it.each(callers)('enforces every human action for $label', async ({ options, allowed }) => {
    const f = fixture()
    for (const method of desktopMethods) {
      const result = await call(f.dispatcher, streaming, request(method), options)
      expect.soft(result, method).toMatchObject(
        allowed
          ? { ok: true }
          : {
              ok: false,
              error: {
                code: 'caller_not_desktop',
                message:
                  'Make this decision in the Axiom app; human actions are not accepted from the CLI or an agent session.'
              }
            }
      )
    }
    expect(f.handler).toHaveBeenCalledTimes(allowed ? desktopMethods.length : 0)
  })
  it.each(callers)('preserves every read for $label', async ({ options }) => {
    const f = fixture()
    for (const method of readMethods) {
      expect(await call(f.dispatcher, streaming, request(method), options), method).toMatchObject({
        ok: true
      })
    }
  })
  it('refuses an unstamped local caller before replaying a desktop receipt', async () => {
    const f = fixture()
    const input = request('axiom.plan.approve')
    const fingerprint = { authenticatedCallerFingerprint: 'same-receipt-owner' }
    expect(
      await call(f.dispatcher, streaming, input, { ...fingerprint, caller: { kind: 'desktop' } })
    ).toMatchObject({ ok: true })
    expect.soft(await call(f.dispatcher, streaming, input, fingerprint)).toMatchObject({
      ok: false,
      error: { code: 'caller_not_desktop' }
    })
    expect(f.handler).toHaveBeenCalledOnce()
  })
})
