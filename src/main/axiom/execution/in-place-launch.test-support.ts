import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import type { RuntimeStore } from '../../runtime/runtime-store-contract'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import { getAppEnvironment } from '../../../shared/app-environment'
import { prepareCodexWorkerLaunchHome } from '../../codex/codex-worker-launch-home'
import * as version from '../../codex/codex-hook-trust-derivation'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import * as rules from '../context-builder/repository-rules'
import { AgentFactory } from '../agent-factory/agent-factory'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { Scheduler } from '../scheduler/scheduler'
import { EffectOutbox } from '../outbox/effect-outbox'
import { preservedRepository } from './preserved-snapshot.test-support'
import { preserveAttemptWorktree } from './preserved-snapshot'
import { createAttemptLauncher, type AttemptWorkerStartArgs } from './attempt-launcher'

export async function inPlaceLaunchFixture() {
  const repo = await preservedRepository()
  const state = await mkdtemp(path.join(tmpdir(), 'axiom-in-place-launch-'))
  const home = path.join(state, 'account home')
  await mkdir(home)
  await writeFile(path.join(home, 'auth.json'), JSON.stringify({ OPENAI_API_KEY: 'fixture' }))
  vi.spyOn(getAppEnvironment(), 'getPath').mockReturnValue(state)
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture rules')
  vi.spyOn(version, 'fingerprintCodex').mockReturnValue(state)
  vi.spyOn(version, 'probeCodexVersion').mockResolvedValue('codex-cli 0.163.0')
  const f = planned(fixture())
  f.controller.startExecution(f.missionId)
  const policy = f.store.getPolicy(f.missionId)
  if (!policy) {
    throw new Error('Missing policy')
  }
  f.store.upsertPolicy(f.missionId, { ...policy, concurrencyLimit: 1 })
  const artifacts = new ArtifactStore(f.store, path.join(state, 'artifacts'))
  const context = new ContextBuilder(f.store, artifacts)
  const factory = new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => [
    'codex'
  ])
  const effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'fixture' })
  const scheduler = new Scheduler(f.db, f.store, f.controller, context, factory, { effects })
  for (const task of f.store.listTaskStages({ missionId: f.missionId })) {
    f.store.updateTaskSpec({
      taskId: task.taskId,
      expectedStage: task.stage,
      spec: { ...task.spec, scope: { allowedPaths: ['**'] } },
      retryPolicy: task.retryPolicy
    })
  }
  const settings: RuntimeStore = {
    getRepos: () => [],
    getRepo: () => undefined,
    addRepo: vi.fn<RuntimeStore['addRepo']>(),
    updateRepo: vi.fn<RuntimeStore['updateRepo']>(),
    getAllWorktreeMeta: () => ({}),
    getWorktreeMeta: () => undefined,
    setWorktreeMeta: vi.fn<RuntimeStore['setWorktreeMeta']>(),
    removeWorktreeMeta: vi.fn<RuntimeStore['removeWorktreeMeta']>(),
    getGitHubCache: vi.fn<RuntimeStore['getGitHubCache']>(),
    getSettings: () => ({
      workspaceDir: state,
      nestWorkspaces: false,
      refreshLocalBaseRefOnWorktreeCreate: false,
      branchPrefix: 'none',
      branchPrefixCustom: '',
      agentCmdOverrides: { codex: '/fixture/codex' }
    })
  }
  let placements = 0
  const runtime = {
    requireStore: () => settings,
    resolveCodexHomeForWorkerLaunch: () => home,
    createManagedWorktree: vi.fn(
      async (args: {
        branchNameOverride?: string
        baseBranch?: string
      }): Promise<CreateWorktreeResult> => {
        const branch = args.branchNameOverride
        if (!branch) {
          throw new Error('Expected branch')
        }
        const directory = placements++ === 0 ? repo.root : path.join(state, `fresh-${placements}`)
        await repo.git(
          directory === repo.root
            ? ['switch', '-c', branch]
            : ['worktree', 'add', '-b', branch, directory, args.baseBranch ?? 'HEAD']
        )
        return {
          worktree: {
            id: `repo::${directory}`,
            repoId: 'repo',
            path: directory,
            head: repo.baselineSha,
            branch,
            isBare: false,
            isMainWorktree: false,
            displayName: 'Attempt',
            comment: '',
            linkedIssue: null,
            linkedPR: null,
            linkedLinearIssue: null,
            isArchived: false,
            isUnread: false,
            isPinned: false,
            sortOrder: 0,
            lastActivityAt: 0
          }
        }
      }
    )
  }
  const startWorker = vi.fn(async (args: AttemptWorkerStartArgs) => {
    const taskId = args.params.task
    const worktreeId = args.controlPlane?.worktreeId
    if (!taskId || !worktreeId) {
      throw new Error('Missing launch identity')
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
      worktreeId,
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    await args.controlPlane?.headless?.prepare(dispatch.id)
    f.db.markWorkerDispatchReady(dispatch.id)
    return { taskId, dispatchId: dispatch.id, state: 'ready' }
  })
  const deps = {
    runtime,
    startWorker,
    db: f.db,
    store: f.store,
    missions: f.controller,
    artifacts,
    resolveBaseEnvironment: async () => ({}),
    codexWorkerHome: () =>
      prepareCodexWorkerLaunchHome({
        resolveHome: () => home,
        allowlist: { skills: [], mcpServers: [] },
        userHomePath: path.join(state, 'user')
      })
  }
  const launch = createAttemptLauncher(deps)
  const admit = async () => {
    const attempt = (await scheduler.scheduleRound(f.missionId, 'manual')).admitted[0]
    if (!attempt) {
      throw new Error('Expected admission')
    }
    return attempt
  }
  const first = await admit()
  await repo.git(['branch', `axiom/integration/${f.missionId}`])
  await launch(first)
  const firstId = f.store.getAttemptBinding(first.taskId, 1)?.dispatchId
  if (!firstId) {
    throw new Error('Expected first dispatch')
  }
  const event = (name: string, id: string) =>
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .findLast((row) => row.event === name && row.objectId === id)?.after
  const interrupt = async (empty = false) => {
    if (!empty) {
      await writeFile(path.join(repo.root, 'partial.txt'), 'unfinished work\n')
    }
    const result = await preserveAttemptWorktree({
      attemptId: firstId,
      taskId: first.taskId,
      seq: 1,
      missionId: f.missionId,
      launch: { worktreePath: repo.root, branch: first.branch, baselineSha: repo.baselineSha },
      allowedPaths: ['**'],
      verificationRules: {}
    })
    if (result.status === 'unavailable') {
      throw new Error(result.reason)
    }
    const failure = {
      taskId: first.taskId,
      reason: 'process_exited',
      evidence: 'exit_code',
      exitCode: 75,
      settlement: { kind: 'interrupted' },
      failure: { class: 'usage_limit', retryable: true, source: 'structured' },
      providerSessionId: 'session-one'
    }
    f.db.failDispatch(firstId, 'fixture interruption', {
      workerProcessExited: true,
      terminationReason: 'process_exited'
    })
    for (const [event, after] of Object.entries({
      'attempt.failed': failure,
      'attempt.preserved': { taskId: first.taskId, baselineSha: repo.baselineSha, result }
    })) {
      f.store.appendAuditEvent({
        missionId: f.missionId,
        actor: 'fixture',
        event,
        objectKind: 'attempt',
        objectId: firstId,
        before: null,
        after
      })
    }
    f.store.updateTaskStage({
      taskId: first.taskId,
      from: 'RUNNING',
      to: 'READY',
      attemptCountDelta: -1
    })
    const now = new Date()
    const day = path.join(
      home,
      'sessions',
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    )
    await mkdir(day, { recursive: true })
    await writeFile(path.join(day, 'rollout-local-session-one.jsonl.zst'), '')
    return { second: await admit(), result }
  }
  return {
    ...f,
    repo,
    state,
    home,
    deps,
    first,
    firstId,
    event,
    interrupt,
    launch,
    close: async () => {
      f.db.close()
      vi.restoreAllMocks()
      await rm(repo.root, { recursive: true, force: true })
      await rm(state, { recursive: true, force: true })
    }
  }
}
