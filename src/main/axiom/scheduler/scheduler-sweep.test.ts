import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RoutingPolicySchema, type Policy } from '../../../shared/axiom-contract/mission-objects'
import * as generated from '../../runtime/orchestration/db/generated-id'
import * as e2e from '../../e2e-config'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { MissionController } from '../mission-controller/mission-controller'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { RulesEngine } from '../decision-engine/rules-engine'
import { EffectOutbox } from '../outbox/effect-outbox'
import { Scheduler } from './scheduler'
import { sweepExecutingMissions } from './mission-sweep'

let f: ReturnType<typeof planned>
let root: string
let context: ContextBuilder
let factory: AgentFactory
let installed: string[]
let scheduler: Scheduler
let effects: EffectOutbox

beforeEach(async () => {
  let next = 0
  vi.spyOn(generated, 'generateId').mockImplementation(
    (prefix) => `${prefix}_${String(++next).padStart(12, '0')}`
  )
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  root = await mkdtemp(path.join(tmpdir(), 'axiom-scheduler-sweep-'))
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  context = new ContextBuilder(f.store, new ArtifactStore(f.store, root))
  installed = ['codex', 'claude']
  factory = new AgentFactory(
    f.store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    async () => installed
  )
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' })
  scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, { effects })
})
afterEach(async () => {
  await effects.stop()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

function task(id: string) {
  const row = f.store.listTaskStages({ missionId: f.missionId }).find((t) => t.spec.id === id)
  if (!row) {
    throw new Error(`Missing ${id}`)
  }
  return row
}
function policy(patch: Partial<Policy>) {
  f.store.upsertPolicy(f.missionId, { ...f.store.getPolicy(f.missionId)!, ...patch })
}
function events(name: string) {
  return f.store.listAuditEvents({ missionId: f.missionId }).filter((e) => e.event === name)
}
function snapshot() {
  return {
    audit: f.store.listAuditEvents({ missionId: f.missionId }),
    effects: f.store.listEffects({ missionId: f.missionId }),
    bindings: f.store.listAttemptBindings({ missionId: f.missionId }),
    specs: f.store.listAgentSpecs(f.missionId),
    contexts: f.db.db
      .prepare('SELECT COUNT(*) AS count FROM context_packages WHERE mission_id = ?')
      .get(f.missionId),
    tasks: f.store.listTaskStages({ missionId: f.missionId })
  }
}

it('a sweep round does not repeat a refusal that has not changed', async () => {
  installed = []
  const ready = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })
  await scheduler.scheduleRound(f.missionId, 'stage_change')
  expect(events('task.admission_refused').map((event) => event.objectId)).toEqual(
    ready.map((row) => row.taskId)
  )
  const before = snapshot()
  await scheduler.scheduleRound(f.missionId, 'sweep')
  expect(snapshot()).toEqual(before)
  await scheduler.scheduleRound(f.missionId, 'policy')
  for (const row of ready) {
    expect(
      events('task.admission_refused').filter((event) => event.objectId === row.taskId)
    ).toHaveLength(2)
  }
  expect(events('task.admission_refused')).toHaveLength(ready.length * 2)
})

it('a sweep round writes a refusal whose data changed', async () => {
  installed = []
  policy({ routing: RoutingPolicySchema.parse({ disallowedProviders: ['codex'] }) })
  await scheduler.scheduleRound(f.missionId, 'stage_change')
  const before = events('task.admission_refused')
  installed = ['codex']
  await scheduler.scheduleRound(f.missionId, 'sweep')
  const changed = events('task.admission_refused').slice(before.length)
  expect(changed).toHaveLength(before.length)
  for (const [index, event] of changed.entries()) {
    expect(event.objectId).toBe(before[index].objectId)
    expect(event.after).not.toEqual(before[index].after)
    expect(event.after).toMatchObject({
      installed: ['codex'],
      filtered: expect.arrayContaining([{ provider: 'codex', reason: 'disallowed' }])
    })
  }
  const once = snapshot()
  await scheduler.scheduleRound(f.missionId, 'sweep')
  expect(snapshot()).toEqual(once)
})

it('a sweep round writes the first refusal after the Task changed stage', async () => {
  installed = []
  const changedId = task('T01').taskId
  const firstId = task('T03').taskId
  const gate = f.db.createGate({ taskId: firstId, question: 'Clarify scope' })
  await scheduler.scheduleRound(f.missionId, 'stage_change')
  const refusal = events('task.admission_refused').find((event) => event.objectId === changedId)!
  expect(events('task.admission_refused').some((event) => event.objectId === firstId)).toBe(false)
  f.controller.transitionTaskStage({
    taskId: changedId,
    to: 'BLOCKED',
    actor: 'test',
    reason: 'hold'
  })
  f.controller.transitionTaskStage({
    taskId: changedId,
    to: 'READY',
    actor: 'test',
    reason: 'retry'
  })
  const stage = f.store.getLatestReadModelAudit({
    missionId: f.missionId,
    objectKind: 'task',
    objectId: changedId,
    events: ['task.stage']
  })!
  expect(stage.sequence).toBeGreaterThan(refusal.sequence)
  f.db.resolveGate(gate.id, 'resolved')
  await scheduler.scheduleRound(f.missionId, 'sweep')
  const repeated = events('task.admission_refused').filter((event) => event.objectId === changedId)
  expect(repeated).toHaveLength(2)
  expect(repeated[1].after).toEqual(refusal.after)
  expect(repeated[1].sequence).toBeGreaterThan(stage.sequence)
  expect(
    events('task.admission_refused').filter((event) => event.objectId === firstId)
  ).toHaveLength(1)
})

it('a sweep round that admits nothing writes nothing', async () => {
  policy({ routing: RoutingPolicySchema.parse({ providerConcurrency: { claude: 1 } }) })
  f.db.createGate({ taskId: task('T03').taskId, question: 'Clarify scope' })
  const first = await scheduler.scheduleRound(f.missionId, 'stage_change')
  expect(first.admitted.map((attempt) => attempt.taskId)).toEqual([task('T01').taskId])
  const before = snapshot()
  const buildContext = vi.spyOn(context, 'build')
  const buildSpec = vi.spyOn(factory, 'build')
  expect(await scheduler.scheduleRound(f.missionId, 'sweep')).toEqual({
    admitted: [],
    skipped: [
      { taskId: task('T02').taskId, reason: 'provider_concurrency' },
      { taskId: task('T03').taskId, reason: 'question' }
    ]
  })
  expect(buildContext).toHaveBeenCalledOnce()
  expect(buildSpec).toHaveBeenCalledOnce()
  expect(snapshot()).toEqual(before)
  policy({ concurrencyLimit: 1 })
  const capped = snapshot()
  expect(await scheduler.scheduleRound(f.missionId, 'sweep')).toEqual({
    admitted: [],
    skipped: [
      { taskId: task('T02').taskId, reason: 'concurrency' },
      { taskId: task('T03').taskId, reason: 'question' }
    ]
  })
  expect(buildContext).toHaveBeenCalledOnce()
  expect(buildSpec).toHaveBeenCalledOnce()
  expect(snapshot()).toEqual(capped)
})

it('a sweep admits what a lost round left', async () => {
  vi.spyOn(e2e, 'getMainE2EConfig').mockReturnValue({ ...e2e.getMainE2EConfig(), enabled: false })
  const paused = planned(
    { db: f.db, store: f.store, controller: new MissionController(f.db, f.store) },
    undefined,
    { targetBranch: 'paused-target' }
  )
  paused.controller.startExecution(paused.missionId)
  paused.controller.pauseMission(paused.missionId)
  const ready = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })
  expect(ready).toHaveLength(3)
  expect(events('scheduler.round')).toEqual([])
  const schedule = vi.spyOn(scheduler, 'scheduleRound')
  sweepExecutingMissions(f.store, scheduler)
  expect(schedule).toHaveBeenCalledExactlyOnceWith(f.missionId, 'sweep')
  await expect(schedule.mock.results[0].value).resolves.toMatchObject({
    admitted: ready.map((row) => expect.objectContaining({ taskId: row.taskId }))
  })
  expect(f.store.listTaskStages({ missionId: f.missionId, stage: 'RUNNING' })).toHaveLength(3)
  expect(events('scheduler.round')).toMatchObject([{ after: { trigger: 'sweep' } }])
  expect(f.store.countTaskStages(paused.missionId)).toMatchObject({ READY: 3, RUNNING: 0 })
})

it('a sweep does not rename a trigger that is already waiting', async () => {
  vi.spyOn(context, 'build').mockImplementationOnce(async () => {
    void scheduler.scheduleRound(f.missionId, 'policy')
    void scheduler.scheduleRound(f.missionId, 'sweep')
    throw new Error('context unavailable')
  })
  const readiness = vi.spyOn(f.controller, 'recomputeReadiness')
  const first = await scheduler.scheduleRound(f.missionId, 'stage_change')
  expect(events('scheduler.round').map((event) => event.after)).toEqual([
    { trigger: 'policy', admitted: first.admitted, skipped: [] }
  ])
  expect(first.admitted).toHaveLength(3)
  expect(readiness).toHaveBeenCalledTimes(2)
  for (const { taskId } of first.admitted) {
    f.controller.transitionTaskStage({ taskId, to: 'NEEDS_FIX', actor: 'test', reason: 'failed' })
    f.controller.transitionTaskStage({ taskId, to: 'READY', actor: 'test', reason: 'retry' })
  }
  vi.spyOn(context, 'build').mockImplementationOnce(async () => {
    void scheduler.scheduleRound(f.missionId, 'sweep')
    throw new Error('context unavailable')
  })
  const second = await scheduler.scheduleRound(f.missionId, 'stage_change')
  expect(second.admitted).toHaveLength(3)
  expect(readiness).toHaveBeenCalledTimes(4)
  expect(events('scheduler.round').map((event) => event.after)).toEqual([
    { trigger: 'policy', admitted: first.admitted, skipped: [] },
    { trigger: 'sweep', admitted: second.admitted, skipped: [] }
  ])
})
