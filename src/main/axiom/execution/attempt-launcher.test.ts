import { registerMissionEffectExecutors } from '../outbox/mission-effect-executors'
import { EffectOutbox } from '../outbox/effect-outbox'
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
import { settleAttemptWithoutSubmission } from './attempt-settlement'
import { previousSubmission } from './attempt-baseline.test-support'
import * as gitRunner from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'

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
  requireStore: () => {
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
  createManagedWorktree.mockReset()
  startWorker.mockReset()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
async function admit(count = 1) {
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, {
    effects: new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' })
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
    from: `orca_session_id:${mission.coordinatorOrcaSessionId}`,
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
    headless: { prepare: expect.any(Function) },
    preambleBuilder: expect.any(Function),
    dispatchMaxDepth: 1,
    callerIdentity: args.callerSession
  })
  const rendered = args.controlPlane?.preambleBuilder?.({
    dispatchId: 'd1',
    taskId: attempt.taskId,
    taskSpec: '',
    coordinatorHandle: args.params.from,
    workerHandle: 'term_worker'
  })
  expect(rendered).toContain('Attempt: d1')
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
      provider: 'codex',
      baseline: { kind: 'integration', reason: 'first_attempt' }
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
  ['failed', 1, 'READY', 'attempt.launch_failed'],
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
    expect(stage()).toBe(count === 1 ? 'READY' : 'BLOCKED')
    expect(events('attempt.launch_failed')[0].after).toMatchObject({ message: 'worktree failed' })
    expect(startWorker).not.toHaveBeenCalled()
  }
)
it('launches the three fixture roots through the adapter and does nothing on the next round', async () => {
  const effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' })
  registerMissionEffectExecutors({
    db: f.db,
    store: f.store,
    missions: f.controller,
    effects,
    launch: launcher(),
    verification: { kick: async () => {} }
  })
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, { effects })
  expect((await scheduler.scheduleRound(f.missionId, 'manual')).admitted).toHaveLength(3)
  effects.start()
  await effects.kick()
  await effects.stop()
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
  expect(stage()).toBe('READY')
})

it.each(['abandoned', 'circuit_broken'] as const)(
  'applies upstream retry admission after %s using the latest dispatch identity',
  async (outcome) => {
    await admit()
    const previous = f.db.createStartingWorkerDispatch({
      taskId: attempt.taskId,
      creator: { kind: 'system' },
      maxDepth: 1,
      startOptions: {}
    }).dispatch
    f.store.bindAttemptDispatch(attempt.taskId, attempt.seq, previous.id)
    if (outcome === 'abandoned') {
      f.db.abandonWorkerDispatch(previous.id, 'test-runtime')
    } else {
      f.db.db
        .prepare('UPDATE dispatch_contexts SET failure_count = 2 WHERE id = ?')
        .run(previous.id)
      f.db.failDispatch(previous.id, 'process exited', {
        workerProcessExited: true,
        terminationReason: 'process_exited'
      })
    }
    settleAttemptWithoutSubmission(
      { store: f.store, missions: f.controller },
      { ...attempt, dispatchId: previous.id, reason: 'attempt_failed', actor: 'RecoveryService' }
    )
    await admit()
    expect(attempt.seq).toBe(2)
    startWorker.mockImplementationOnce(async (args) => {
      expect(args.params.retryOf).toBe(previous.id)
      const next = f.db.createStartingWorkerDispatch({
        taskId: attempt.taskId,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {},
        retryOf: args.params.retryOf
      }).dispatch
      expect(next.retry_of_dispatch_id).toBe(previous.id)
      return { taskId: attempt.taskId, dispatchId: next.id, state: 'ready' }
    })
    await launcher()(attempt)
    if (outcome === 'circuit_broken') {
      expect(stage()).toBe('BLOCKED')
      expect(binding()?.dispatchId).toBeNull()
      expect(events('attempt.launch_failed')[0].after).toMatchObject({
        message: expect.stringContaining('will not retry it again')
      })
      expect(f.db.getDispatchContext(attempt.taskId)?.id).toBe(previous.id)
    } else {
      expect(stage()).toBe('RUNNING')
      expect(binding()?.dispatchId).not.toBeNull()
    }
  }
)

async function admitAfterSubmission(reason = 'checks_failed', submitted = true) {
  await admit()
  const dispatch = f.db.createStartingWorkerDispatch({
    taskId: attempt.taskId,
    creator: { kind: 'system' },
    maxDepth: 1,
    startOptions: {}
  }).dispatch
  f.store.bindAttemptDispatch(attempt.taskId, 1, dispatch.id)
  f.db.settleWorkerReport({
    taskId: attempt.taskId,
    dispatchId: dispatch.id,
    outcome: 'succeeded',
    result: 'submitted'
  })
  expect(f.db.getTask(attempt.taskId)?.status).toBe('completed')
  const previous = submitted
    ? previousSubmission(f.store, {
        missionId: f.missionId,
        taskId: attempt.taskId,
        dispatchId: dispatch.id,
        reason
      })
    : undefined
  f.store.updateTaskStage({ taskId: attempt.taskId, from: 'RUNNING', to: 'READY' })
  await admit()
  expect(attempt.seq).toBe(2)
  return previous
}

function worktreeResult(head?: string): CreateWorktreeResult {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only id/path/git.head are read; the fake kernel never accesses catalog fields.
  return {
    worktree: { id: 'wt-created', path: root, ...(head ? { git: { head } } : {}) }
  } as CreateWorktreeResult
}

it.each(['ready', 'outcome_unknown', 'failed'] as const)(
  'continues the Candidate, reopens completed and audits %s',
  async (state) => {
    const previous = (await admitAfterSubmission())!
    const reopen = vi.spyOn(f.db, 'updateTaskStatus')
    createManagedWorktree.mockImplementationOnce(async (args) => {
      expect(reopen).not.toHaveBeenCalled()
      expect(args.baseBranch).toBe(previous.candidate.commitSha)
      return worktreeResult(previous.candidate.commitSha)
    })
    startWorker.mockImplementationOnce(async (args) => {
      expect(reopen).toHaveBeenCalledWith(attempt.taskId, 'ready')
      expect(args.existingTask?.status).toBe('ready')
      expect(args.params.retryOf).toBeUndefined()
      const next = f.db.createStartingWorkerDispatch({
        taskId: attempt.taskId,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {}
      }).dispatch
      return { taskId: attempt.taskId, dispatchId: next.id, state }
    })
    await launcher()(attempt)
    expect(startWorker).toHaveBeenCalledOnce()
    const event =
      state === 'ready'
        ? 'attempt.started'
        : state === 'failed'
          ? 'attempt.launch_failed'
          : 'attempt.start_unknown'
    expect(events(event).at(-1)?.after).toMatchObject({
      seq: 2,
      orcaTaskReopened: true,
      baseline: {
        kind: 'candidate',
        candidateId: previous.candidate.id,
        commitSha: previous.candidate.commitSha
      }
    })
  }
)

it('reads HEAD with the shared Git runner when creation omits git.head', async () => {
  const previous = (await admitAfterSubmission())!
  createManagedWorktree.mockResolvedValueOnce(worktreeResult())
  const git = vi
    .spyOn(gitRunner, 'gitExecFileAsync')
    .mockResolvedValue({ stdout: `${previous.candidate.commitSha}\n`, stderr: '' })
  await launcher()(attempt)
  expect(git.mock.calls).toEqual([[['rev-parse', 'HEAD'], gitOptionsForWorktree(root)]])
  expect(startWorker).toHaveBeenCalledOnce()
})

it.each([true, false])(
  'fails a mismatched HEAD without reopening, resetting or starting (metadata %s)',
  async (metadata) => {
    await admitAfterSubmission()
    createManagedWorktree.mockResolvedValueOnce(
      worktreeResult(metadata ? 'b'.repeat(40) : undefined)
    )
    const git = vi
      .spyOn(gitRunner, 'gitExecFileAsync')
      .mockResolvedValue({ stdout: `${'b'.repeat(40)}\n`, stderr: '' })
    const reopen = vi.spyOn(f.db, 'updateTaskStatus')
    await launcher()(attempt)
    expect(events('attempt.launch_failed').at(-1)?.after).toMatchObject({
      message: 'fix_base_mismatch'
    })
    expect(stage()).toBe('BLOCKED')
    expect(binding()?.dispatchId).toBeNull()
    expect(startWorker).not.toHaveBeenCalled()
    expect(reopen).not.toHaveBeenCalled()
    expect(git.mock.calls.map(([args]) => args)).toEqual(metadata ? [] : [['rev-parse', 'HEAD']])
  }
)

it('reopens a submitted secret failure but starts clean on integration', async () => {
  await admitAfterSubmission('secret_detected')
  const reopen = vi.spyOn(f.db, 'updateTaskStatus')
  await launcher()(attempt)
  expect(createManagedWorktree).toHaveBeenCalledWith(
    expect.objectContaining({ baseBranch: `axiom/integration/${f.missionId}` })
  )
  expect(reopen).toHaveBeenCalledWith(attempt.taskId, 'ready')
  expect(startWorker.mock.calls[0][0].params.retryOf).toBeUndefined()
  expect(events('attempt.started').at(-1)?.after).toMatchObject({
    baseline: { kind: 'integration', reason: 'secret_detected' },
    orcaTaskReopened: true
  })
})

it('leaves completed without a previous Submission unstartable', async () => {
  await admitAfterSubmission('checks_failed', false)
  const reopen = vi.spyOn(f.db, 'updateTaskStatus')
  startWorker.mockImplementationOnce(async () => {
    f.db.createStartingWorkerDispatch({
      taskId: attempt.taskId,
      creator: { kind: 'system' },
      maxDepth: 1,
      startOptions: {}
    })
    throw new Error('Unexpected dispatch')
  })
  await launcher()(attempt)
  expect(reopen).not.toHaveBeenCalled()
  expect(stage()).toBe('BLOCKED')
  expect(events('attempt.launch_failed').at(-1)?.after).toMatchObject({
    message: expect.stringContaining('only a ready Task can start')
  })
})

it('skips a recovered superseded admission before host launch while the current Attempt remains authoritative', async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  const effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'restarted' })
  try {
    const policy = f.store.getPolicy(f.missionId)
    if (!policy) {
      throw new Error('Expected the Mission policy')
    }
    f.store.upsertPolicy(f.missionId, { ...policy, concurrencyLimit: 1 })
    const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, { effects })
    const first = (await scheduler.scheduleRound(f.missionId, 'manual')).admitted[0]
    const leased = f.store.leaseDueEffect({
      kind: 'attempt.dispatch',
      missionId: f.missionId,
      now: new Date().toISOString(),
      epoch: 'previous'
    })
    expect(leased).toMatchObject({ key: `${first.taskId}/1`, status: 'running' })
    expect(
      settleAttemptWithoutSubmission(
        { store: f.store, missions: f.controller },
        { ...first, dispatchId: null, reason: 'launch_pending_orphan', actor: 'RecoveryService' }
      )
    ).toEqual({ settled: true })
    vi.setSystemTime(Date.now() + 1_000)
    const second = (await scheduler.scheduleRound(f.missionId, 'manual')).admitted[0]
    expect(second).toMatchObject({ taskId: first.taskId, seq: 2 })
    const starts: { seq: number; latestSeq: number }[] = []
    startWorker.mockImplementation(async (args) => {
      const taskId = args.params.task
      if (!taskId) {
        throw new Error('Expected the admitted Task')
      }
      const { dispatch } = f.db.createStartingWorkerDispatch({
        taskId,
        creator: { kind: 'system' },
        maxDepth: 1,
        startOptions: {},
        retryOf: args.params.retryOf
      })
      f.db.prepareStartingWorkerAuthority({
        dispatchId: dispatch.id,
        handle: `term_${dispatch.id}`,
        paneKey: `pane_${dispatch.id}`,
        processIncarnation: `process_${dispatch.id}`,
        worktreeId: 'wt-created',
        setupState: 'not_applicable',
        effects: [],
        terminalOwnership: 'created'
      })
      f.db.markWorkerDispatchReady(dispatch.id)
      return { taskId, dispatchId: dispatch.id, state: 'ready' }
    })
    const launch = launcher()
    registerMissionEffectExecutors({
      db: f.db,
      store: f.store,
      missions: f.controller,
      effects,
      verification: { kick: async () => {} },
      launch: async (admitted) => {
        starts.push({ seq: admitted.seq, latestSeq: f.store.nextAttemptSeq(admitted.taskId) - 1 })
        await launch(admitted)
        if (admitted.seq === 2) {
          const binding = f.store.getAttemptBinding(admitted.taskId, 2)
          if (!binding?.dispatchId) {
            throw new Error('Expected the current Attempt to bind its dispatch')
          }
          // The host exits before RecoveryService changes the Task's RUNNING projection.
          f.db.failDispatch(binding.dispatchId, 'Host exited before reconciliation', {
            workerProcessExited: true,
            terminationReason: 'process_exited'
          })
        }
      }
    })
    vi.setSystemTime(Date.now() + 1_000)
    await effects.recoverAtBoot()
    expect(f.store.getEffect('attempt.dispatch', `${first.taskId}/1`)).toMatchObject({
      status: 'pending',
      dueAt: new Date().toISOString()
    })
    effects.start()
    await effects.kick()
    expect(starts).toEqual([{ seq: 2, latestSeq: 2 }])
    expect(startWorker).toHaveBeenCalledOnce()
    expect(createManagedWorktree).toHaveBeenCalledOnce()
    expect(f.store.getAttemptBinding(first.taskId, 1)?.dispatchId).toBeNull()
    expect(f.store.getAttemptBinding(first.taskId, 2)?.dispatchId).toBe(
      f.db.getDispatchContext(first.taskId)?.id
    )
    expect(f.store.getTaskStage(first.taskId)).toMatchObject({ stage: 'RUNNING', attemptCount: 2 })
    expect(f.store.listEffects({ missionId: f.missionId })).toMatchObject([
      { key: `${first.taskId}/1`, status: 'done', attempts: 0 },
      { key: `${first.taskId}/2`, status: 'done', attempts: 0 }
    ])
  } finally {
    await effects.stop()
    vi.useRealTimers()
  }
})
