import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { RuntimeManagedWorktreeCreateArgs } from '../../runtime/runtime-managed-worktree-create-types'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { Scheduler, type AdmittedAttempt } from '../scheduler/scheduler'
import { createAttemptLauncher, type AttemptWorkerStartArgs } from './attempt-launcher'

let f: ReturnType<typeof planned>
let root: string
let artifacts: ArtifactStore
let context: ContextBuilder
let factory: AgentFactory
let attempt: AdmittedAttempt
const createManagedWorktree = vi.fn(async (_args: RuntimeManagedWorktreeCreateArgs) => {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the launcher reads only worktree.id; all host effects are replaced by startWorker.
  return { worktree: { id: 'wt-created' } } as CreateWorktreeResult
})
const runtime = {
  createManagedWorktree,
  getClientSettings: () => {
    throw new Error('No settings in fake host')
  }
}
const startWorker = vi.fn(async (args: AttemptWorkerStartArgs) => {
  expect(args.params.worktree).toBe('current')
  return { taskId: args.params.task, dispatchId: `d-${args.params.task}`, state: 'ready' }
})
function launcher() {
  return createAttemptLauncher({
    runtime,
    db: f.db,
    store: f.store,
    missions: f.controller,
    artifacts,
    startWorker
  })
}
function stage() {
  return f.store.getTaskStage(attempt.taskId)?.stage
}
function binding() {
  return f.store.getAttemptBinding(attempt.taskId, attempt.seq)
}
function events(name: string) {
  return f.store.listAuditEvents({ missionId: f.missionId }).filter((e) => e.event === name)
}
beforeEach(async () => {
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  root = await mkdtemp(path.join(tmpdir(), 'axiom-launch-'))
  f = planned(fixture())
  f.controller.startExecution(f.missionId)
  artifacts = new ArtifactStore(f.store, root)
  context = new ContextBuilder(f.store, artifacts)
  factory = new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => [
    'codex'
  ])
})
afterEach(async () => {
  vi.restoreAllMocks()
  createManagedWorktree.mockClear()
  startWorker.mockClear()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
async function admit(count = 1) {
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, {
    launch: async () => {}
  })
  attempt = (await scheduler.scheduleRound(f.missionId, 'manual')).admitted[0]
  if (count > 1) {
    f.store.updateTaskStage({
      taskId: attempt.taskId,
      from: 'RUNNING',
      to: 'RUNNING',
      attemptCountDelta: count - 1
    })
  }
}
it('kernel inputs: precreates from integration base and sends one synthetic caller with the D14 bag', async () => {
  await admit()
  await launcher()(attempt)
  const mission = f.controller.getMission(f.missionId)
  expect(createManagedWorktree).toHaveBeenCalledWith({
    repoSelector: `id:${mission.repoId}`,
    name: `attempt-${attempt.taskId}-1`,
    baseBranch: `axiom/integration/${f.missionId}`,
    branchNameOverride: attempt.branch,
    runHooks: false,
    setupDecision: 'run',
    awaitTerminalProvisioning: true,
    observeSetupCompletion: true,
    createdWithAgent: 'codex',
    activate: false,
    lineage: {
      noParent: true,
      orchestrationContext: { orchestrationRunId: mission.runId, taskId: attempt.taskId }
    }
  })
  const args = startWorker.mock.calls[0][0]
  expect(args.coordinator).toBe(args.callerSession)
  expect(args.params).toEqual({
    from: `session:${mission.coordinatorOrcaSessionId}`,
    task: attempt.taskId,
    worktree: 'current',
    agent: 'codex',
    model: undefined,
    effort: undefined,
    timeoutMs: 60_000
  })
  expect(args.existingTask?.id).toBe(attempt.taskId)
  expect(args.run.id).toBe(mission.runId)
  expect(args.controlPlane).toEqual({
    dispatchCreator: { kind: 'system' },
    worktreeId: 'wt-created',
    preambleBuilder: expect.any(Function),
    dispatchMaxDepth: 1,
    callerIdentity: args.callerSession
  })
  const rendered = args.controlPlane?.preambleBuilder?.({
    dispatchId: 'd1',
    dispatchCapability: 'dcap_x',
    taskId: attempt.taskId,
    taskSpec: '',
    coordinatorHandle: args.params.from,
    workerHandle: 'term_worker'
  })
  expect(rendered).toContain('--attempt d1 --dispatch-capability dcap_x')
  expect(rendered).not.toContain('{{')
  expect(binding()?.dispatchId).toBe(`d-${attempt.taskId}`)
  expect(stage()).toBe('RUNNING')
  expect(events('attempt.started')[0]).toMatchObject({
    objectKind: 'attempt',
    objectId: `d-${attempt.taskId}`,
    after: {
      taskId: attempt.taskId,
      seq: 1,
      branch: attempt.branch,
      worktreeId: 'wt-created',
      provider: 'codex'
    }
  })
  console.log(
    '[M2-05 kernel inputs]',
    JSON.stringify({
      params: args.params,
      controlPlane: {
        ...args.controlPlane,
        preambleBuilder: '<ContextPackage template substitution>'
      },
      sameCaller: args.coordinator === args.callerSession
    })
  )
})
it('policy-default model leaves model and effort undefined', async () => {
  await admit()
  expect(f.store.getAgentSpec(attempt.agentSpecId)?.spec.model).toBe('policy-default')
  await launcher()(attempt)
  const { params } = startWorker.mock.calls[0][0]
  expect(params.model).toBeUndefined()
  expect(params.effort).toBeUndefined()
  expect(stage()).toBe('RUNNING')
})
it('explicit routing model passes both model and reasoning effort', async () => {
  const policy = f.store.getPolicy(f.missionId)!
  f.store.upsertPolicy(f.missionId, {
    ...policy,
    routing: { ...policy.routing, models: { codex: 'gpt-5.6-sol' } }
  })
  await admit()
  await launcher()(attempt)
  const { params } = startWorker.mock.calls[0][0]
  expect(params.model).toBe('gpt-5.6-sol')
  expect(params.effort).toBe('medium')
  expect(stage()).toBe('RUNNING')
})
it.each([
  ['ready', 1, 'RUNNING', 'attempt.started'],
  ['failed', 1, 'NEEDS_FIX', 'attempt.launch_failed'],
  ['failed', 2, 'BLOCKED', 'attempt.launch_failed'],
  ['outcome_unknown', 1, 'RUNNING', 'attempt.start_unknown']
] as const)('settles %s with count %i to %s', async (state, count, expected, event) => {
  await admit(count)
  startWorker.mockResolvedValueOnce({ taskId: attempt.taskId, dispatchId: 'd1', state })
  await expect(launcher()(attempt)).resolves.toBeUndefined()
  expect(binding()?.dispatchId).toBe('d1')
  expect(stage()).toBe(expected)
  expect(events(event)).toHaveLength(1)
})
it.each([1, 2])(
  'settles a pre-dispatch exception with count %i without rejecting',
  async (count) => {
    await admit(count)
    createManagedWorktree.mockRejectedValueOnce(new Error('worktree failed'))
    await expect(launcher()(attempt)).resolves.toBeUndefined()
    expect(binding()?.dispatchId).toBeNull()
    expect(stage()).toBe(count === 1 ? 'NEEDS_FIX' : 'BLOCKED')
    expect(events('attempt.launch_failed')[0].after).toMatchObject({ message: 'worktree failed' })
    expect(startWorker).not.toHaveBeenCalled()
  }
)
it('launches the three fixture roots through the adapter and does nothing on the next round', async () => {
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, {
    launch: launcher()
  })
  expect((await scheduler.scheduleRound(f.missionId, 'manual')).admitted).toHaveLength(3)
  expect((await scheduler.scheduleRound(f.missionId, 'manual')).admitted).toEqual([])
  expect(startWorker).toHaveBeenCalledTimes(3)
  expect(f.store.listAttemptBindings({ missionId: f.missionId }).every((b) => b.dispatchId)).toBe(
    true
  )
  expect(f.store.countTaskStages(f.missionId)).toMatchObject({ RUNNING: 3, DEFINED: 9 })
})

it('does not launch an already bound admission twice', async () => {
  await admit()
  const launch = launcher()
  await launch(attempt)
  await launch(attempt)
  expect(startWorker).toHaveBeenCalledTimes(1)
})
it('settles a thrown kernel validation error before dispatch', async () => {
  await admit()
  startWorker.mockRejectedValueOnce(new Error('invalid caller'))
  await expect(launcher()(attempt)).resolves.toBeUndefined()
  expect(binding()?.dispatchId).toBeNull()
  expect(stage()).toBe('NEEDS_FIX')
})
