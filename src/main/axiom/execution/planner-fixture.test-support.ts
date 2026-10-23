import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vi } from 'vitest'
import { rpcFixture } from '../rpc-fixture.test-support'
import { getAxiomControlPlane } from '../control-plane'
import { createInput } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import { AgentFactory } from '../agent-factory/agent-factory'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import * as rules from '../context-builder/repository-rules'
import * as git from '../../git/runner'
import type { AttemptWorkerStartArgs } from './attempt-launcher'

export async function plannerFixture() {
  const f = rpcFixture()
  const plane = getAxiomControlPlane(f.runtime)
  const missions = plane.missions
  const { mission, goalRevision } = missions.createMission(createInput)
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-planner-'))
  const artifacts = new ArtifactStore(f.store, root)
  const contextBuilder = new ContextBuilder(f.store, artifacts)
  const installed = vi.fn(async () => ['codex'])
  const agentFactory = new AgentFactory(
    f.store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    installed
  )
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Fixture repository rules')
  const gitRun = vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: '', stderr: '' })
  const createWorktree = vi.spyOn(f.runtime, 'createManagedWorktree').mockResolvedValue(
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: launcher only reads worktree.id; the host start is stubbed below.
    { worktree: { id: 'repo::/fixture/planner' } } as Awaited<
      ReturnType<typeof f.runtime.createManagedWorktree>
    >
  )
  vi.spyOn(f.runtime, 'getClientSettings').mockImplementation(() => {
    throw new Error('No settings')
  })
  vi.spyOn(f.runtime, 'getTerminalPaneKey').mockReturnValue('planner-pane')
  vi.spyOn(f.runtime, 'getTerminalProcessIncarnation').mockReturnValue('planner-process')
  vi.spyOn(f.runtime, 'notifyMessageArrived').mockImplementation(() => {})
  const from = 'term_planner'
  const startWorker = vi.fn(async (args: AttemptWorkerStartArgs) => {
    const { dispatch } = f.db.createStartingWorkerDispatch({
      taskId: args.params.task,
      creator: { kind: 'system' },
      maxDepth: 1,
      startOptions: { topology: 'current', agent: 'codex' }
    })
    f.db.prepareStartingWorkerAuthority({
      dispatchId: dispatch.id,
      handle: from,
      paneKey: 'planner-pane',
      processIncarnation: 'planner-process',
      worktreeId: 'repo::/fixture/planner',
      setupState: 'not_applicable',
      effects: [],
      terminalOwnership: 'created'
    })
    f.db.markWorkerDispatchReady(dispatch.id)
    return { taskId: args.params.task, dispatchId: dispatch.id, state: 'ready' }
  })
  return {
    ...f,
    missions,
    mission,
    goalRevision,
    root,
    artifacts,
    contextBuilder,
    agentFactory,
    installed,
    gitRun,
    createWorktree,
    startWorker,
    from,
    deps: {
      runtime: f.runtime,
      db: f.db,
      store: f.store,
      missions,
      artifacts,
      contextBuilder,
      agentFactory,
      startWorker
    },
    async close() {
      f.db.close()
      await rm(root, { recursive: true, force: true })
      vi.restoreAllMocks()
    }
  }
}
