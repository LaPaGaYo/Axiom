import './unused-default-rpc-methods.test-fixture'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { defineMethod } from './core'
import { RpcDispatcher } from './dispatcher'
import {
  needsOrchestrationCallerResolution,
  ORCHESTRATION_CALLER_PARAM
} from './orchestration-session-caller'
import {
  createSessionCallerHarness,
  orchestrationRequest,
  SESSION_X
} from './orchestration-session-caller-test-fixture'
import { AXIOM_ATTEMPT_CALLER_METHODS } from '../../../shared/axiom-contract/attempt-caller-methods'
import { AXIOM_METHODS } from './methods/axiom'
import { AxiomStore } from '../../axiom/db/axiom-store'
import { MissionController } from '../../axiom/mission-controller/mission-controller'
import { createInput } from '../../axiom/mission-controller/controller-fixture.test-support'
import { formatOrcaSessionAddress } from '../../../shared/orca-session-address'

const hostRef = vi.hoisted((): { current: unknown } => ({ current: null }))
vi.mock('../../native-chat/agent-session-wire/structured-agent-session-registry', () => ({
  getStructuredAgentSessionHost: () => hostRef.current
}))
let h: ReturnType<typeof createSessionCallerHarness>
beforeEach(() => {
  h = createSessionCallerHarness(hostRef)
})
afterEach(() => {
  h.close()
  vi.restoreAllMocks()
})

it('pins the real admission gate: all orchestration methods and only listed Axiom methods', () => {
  for (const method of [
    ...Object.keys(ORCHESTRATION_CALLER_PARAM),
    'orchestration.reset',
    'orchestration.runShow',
    ...AXIOM_ATTEMPT_CALLER_METHODS
  ]) {
    expect(
      needsOrchestrationCallerResolution(
        orchestrationRequest(method, {}, { sessionId: SESSION_X })
      ),
      method
    ).toBe(true)
  }
  for (const method of [
    ...AXIOM_METHODS.map((m) => m.name).filter(
      (name) => !AXIOM_ATTEMPT_CALLER_METHODS.includes(name)
    ),
    'agentSession.respondToApproval',
    'agentSession.respondToQuestion',
    'settings.update'
  ]) {
    expect(
      needsOrchestrationCallerResolution(
        orchestrationRequest(method, {}, { sessionId: SESSION_X })
      ),
      method
    ).toBe(false)
  }
})
it('sets ctx for unlisted orchestration reads but not human Axiom or agentSession calls', async () => {
  const names = [
    'orchestration.runShow',
    'orchestration.reset',
    'axiom.policy.update',
    'agentSession.respondToApproval'
  ]
  const dispatcher = new RpcDispatcher({
    runtime: h.runtime,
    methods: names.map((name) =>
      defineMethod({
        name,
        permission: name === 'orchestration.reset' ? 'host-admin' : 'workspace',
        params: z.record(z.string(), z.unknown()),
        handler: (params, ctx) => ({ session: ctx.orchestrationCaller?.sessionId ?? null, params })
      })
    )
  })
  for (const method of names) {
    expect(
      await dispatcher.dispatch(orchestrationRequest(method, {}, { sessionId: SESSION_X }), {
        caller: { kind: 'desktop' }
      })
    ).toMatchObject({
      ok: true,
      result: {
        session: method.startsWith('orchestration.') ? SESSION_X : null,
        params: {}
      }
    })
  }
})
it('enforces the second layer through the real dispatcher for attributed methods', async () => {
  const store = new AxiomStore(h.db)
  const controller = new MissionController(h.db, store)
  const { mission } = controller.createMission(createInput)
  const task = h.db.createTask({ runId: mission.runId, spec: 'Planner' })
  const dispatch = h.db.createDispatchContext({
    taskId: task.id,
    assigneeHandle: formatOrcaSessionAddress(SESSION_X),
    creator: { kind: 'system' },
    maxDepth: 1
  })
  store.insertAttemptBinding({
    taskId: task.id,
    missionId: mission.id,
    seq: 1,
    branch: `axiom/planner/${mission.id}/1`,
    dispatchId: dispatch.id,
    agentSpecId: 'spec',
    contextPackageId: 'ctx'
  })
  const handler = vi.fn(() => ({}))
  const dispatcher = new RpcDispatcher({
    runtime: h.runtime,
    methods: [
      defineMethod({
        name: 'axiom.artifact.put',
        permission: 'workspace',
        params: z.record(z.string(), z.unknown()),
        handler
      }),
      defineMethod({
        name: 'orchestration.workerStart',
        permission: 'workspace',
        params: z.record(z.string(), z.unknown()),
        handler
      }),
      defineMethod({
        name: 'orchestration.reset',
        permission: 'host-admin',
        params: z.record(z.string(), z.unknown()),
        handler
      }),
      defineMethod({
        name: 'orchestration.runShow',
        permission: 'workspace',
        params: z.record(z.string(), z.unknown()),
        handler
      })
    ]
  })
  for (const method of ['orchestration.workerStart', 'orchestration.reset']) {
    expect
      .soft(await dispatcher.dispatch(orchestrationRequest(method, {}, { sessionId: SESSION_X })))
      .toMatchObject({ ok: false, error: { code: 'caller_not_permitted_for_agent' } })
  }
  expect(handler).not.toHaveBeenCalled()
  expect
    .soft(
      await dispatcher.dispatch(
        orchestrationRequest('axiom.artifact.put', {}, { sessionId: SESSION_X })
      )
    )
    .toMatchObject({ ok: false, error: { code: 'caller_not_desktop' } })
  expect(
    await dispatcher.dispatch(
      orchestrationRequest('orchestration.runShow', {}, { sessionId: SESSION_X })
    )
  ).toMatchObject({ ok: true })
  const refused = store
    .listAuditEvents({ missionId: mission.id })
    .filter((row) => row.event === 'authority.refused')
  expect(refused).toHaveLength(3)
  expect(refused).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        objectKind: 'task',
        objectId: task.id,
        after: {
          method: 'axiom.artifact.put',
          callerKind: 'local-cli',
          attemptId: dispatch.id
        }
      })
    ])
  )
})
