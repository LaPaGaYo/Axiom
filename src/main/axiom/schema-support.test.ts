import { randomUUID } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { AXIOM_SCHEMA_VERSION } from '../runtime/orchestration/db/schema/axiom-schema-steps'
import { RpcDispatcher } from '../runtime/rpc/dispatcher'
import { ORCHESTRATION_METHODS } from '../runtime/rpc/methods/orchestration'
import { createOrchestrationWorkerReleaseHarness } from '../runtime/rpc/methods/orchestration/worker/worker-release.test-support'
import { getAxiomControlPlane } from './control-plane'
import { startAxiomControlPlane, stopAxiomControlPlane } from './control-plane-boot'
import { mailboxRuntime } from './mailbox-runtime.test-support'
import { MissionControllerError } from './mission-controller/controller-context'
import { createParams, rpcFixture } from './rpc-fixture.test-support'

const disposals: (() => void)[] = []
const stored = AXIOM_SCHEMA_VERSION + 1

afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of disposals.splice(0).toReversed()) {
    dispose()
  }
  vi.useRealTimers()
})

function openDatabase() {
  const db = new OrchestrationDb(':memory:')
  disposals.push(() => db.close())
  return db
}

function stampNewer(db: OrchestrationDb) {
  db.db.prepare('UPDATE axiom_schema SET version = ? WHERE id = 1').run(stored)
}

function snapshot(db: OrchestrationDb) {
  return ['axiom_schema', 'missions', 'audit_events', 'axiom_effects'].map((table) =>
    db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
  )
}

function expectRefusalData(data: unknown) {
  expect(data).toEqual({
    reason: expect.stringContaining('written by a newer Axiom'),
    stored,
    supported: AXIOM_SCHEMA_VERSION,
    nextSteps: [expect.stringContaining('Update Axiom')]
  })
  for (const version of [stored, AXIOM_SCHEMA_VERSION]) {
    expect(data).toMatchObject({
      reason: expect.stringContaining(String(version)),
      nextSteps: [expect.stringContaining(String(version))]
    })
  }
}

it('a database stamped by a newer Axiom gets no Control Plane', () => {
  const db = openDatabase()
  const runtime = mailboxRuntime(db)
  stampNewer(db)
  const before = snapshot(db)
  for (let call = 0; call < 2; call += 1) {
    let refusal: unknown
    try {
      getAxiomControlPlane(runtime)
    } catch (error) {
      refusal = error
    }
    expect(refusal).toBeInstanceOf(MissionControllerError)
    if (!(refusal instanceof MissionControllerError)) {
      throw new Error('Expected a schema refusal')
    }
    expect(refusal.code).toBe('axiom_schema_newer')
    expectRefusalData(refusal.data)
    expect(snapshot(db)).toEqual(before)
  }
})

it('a database at the Axiom schema version of this build gets its Control Plane as before', () => {
  const db = openDatabase()
  const runtime = mailboxRuntime(db)
  const plane = getAxiomControlPlane(runtime)
  expect(plane.store).toBeDefined()
  expect(getAxiomControlPlane(runtime)).toBe(plane)
})

it('an axiom request on a newer database answers the refusal with its reason and next step', async () => {
  const f = rpcFixture()
  disposals.push(() => f.db.close())
  stampNewer(f.db)
  for (const [method, params] of [
    ['axiom.mission.list', {}],
    ['axiom.mission.create', createParams]
  ] as const) {
    const response = await f.call(method, params)
    expect(response).toMatchObject({
      ok: false,
      error: { code: 'axiom_schema_newer', message: 'axiom_schema_newer' }
    })
    if (response.ok) {
      throw new Error('Expected an RPC refusal')
    }
    expectRefusalData(response.error.data)
  }
  expect(f.db.db.prepare('SELECT * FROM missions').all()).toEqual([])
  expect(f.db.db.prepare('SELECT * FROM audit_events').all()).toEqual([])
  expect(await f.call('axiom.namespace.get', undefined)).toMatchObject({ ok: true })
})

it('kernel verbs that must ask whether a Mission owns the Run are refused on a newer database', async () => {
  const kernel = createOrchestrationWorkerReleaseHarness()
  kernel.setup()
  disposals.push(() => kernel.cleanup())
  const { db, runtime, activeRunId: run } = kernel
  db.createTask({ spec: 'Existing unmanaged task', runId: run })
  stampNewer(db)
  const before = db.listTasks({ runId: run })
  const dispatcher = new RpcDispatcher({ runtime, methods: ORCHESTRATION_METHODS })
  const call = (verb: string, params: unknown) =>
    dispatcher.dispatch({
      id: randomUUID(),
      authToken: 'test-caller',
      method: `orchestration.${verb}`,
      params,
      orchestrationContractVersion: 1,
      orchestrationRequestId: randomUUID()
    })
  for (const [verb, params] of [
    ['taskCreate', { spec: 'New task', run, callerTerminalHandle: 'term_coord' }],
    ['reset', { all: true }]
  ] as const) {
    expect(await call(verb, params)).toMatchObject({
      ok: false,
      error: { code: 'axiom_schema_newer' }
    })
  }
  expect(await call('taskList', { run })).toMatchObject({ ok: true })
  expect(db.listTasks({ runId: run })).toEqual(before)
})

it('start leaves a newer database alone and stop does not throw', async () => {
  vi.useFakeTimers()
  const db = openDatabase()
  const runtime = mailboxRuntime(db)
  disposals.push(() => stopAxiomControlPlane(runtime))
  stampNewer(db)
  const before = snapshot(db)
  const timers = vi.getTimerCount()
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  expect(await startAxiomControlPlane(runtime)).toBeUndefined()
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    '[axiom] Control Plane not started: database written by a newer Axiom',
    expect.objectContaining({ stored, supported: AXIOM_SCHEMA_VERSION })
  )
  expect(vi.getTimerCount()).toBe(timers)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(snapshot(db)).toEqual(before)
  warn.mockClear()
  expect(() => stopAxiomControlPlane(runtime)).not.toThrow()
  expect(warn).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(timers)
})

it('an error that is not the refusal is thrown on by start and stop', async () => {
  const db = openDatabase()
  const runtime = mailboxRuntime(db)
  const failure = new Error('Database unavailable for this test')
  vi.spyOn(runtime, 'getOrchestrationDb').mockImplementation(() => {
    throw failure
  })
  await expect(startAxiomControlPlane(runtime)).rejects.toBe(failure)
  expect(() => stopAxiomControlPlane(runtime)).toThrow(failure)
})
