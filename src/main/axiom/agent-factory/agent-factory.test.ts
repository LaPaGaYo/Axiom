import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  goal,
  makeProposal,
  policy,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { canonicalAgentSpec } from '../../../shared/axiom-contract/agent-spec'
import { RoutingPolicySchema, type TaskSpec } from '../../../shared/axiom-contract/mission-objects'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import * as generated from '../../runtime/orchestration/db/generated-id'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from '../mission-controller/mission-controller'
import { ArtifactStore, sha256 } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import { RulesEngine } from '../decision-engine/rules-engine'
import { AgentFactory, buildWorkerContracts } from './agent-factory'
import { PROVIDER_SELECTION_RULES } from './provider-selection'

let root: string
let db: OrchestrationDb
let store: AxiomStore
let factory: AgentFactory
let missionId: string
let goalRevisionId: string
let taskId: string
let contextPackageId: string
let taskSpec: TaskSpec
let installed: string[]
let engine: RulesEngine

beforeEach(async () => {
  let next = 0
  vi.spyOn(generated, 'generateId').mockImplementation(
    (prefix) => `${prefix}_${String(++next).padStart(12, '0')}`
  )
  root = await mkdtemp(path.join(tmpdir(), 'axiom-factory-'))
  const git = (args: string[]) => gitExecFileAsync(args, gitOptionsForWorktree(root))
  await git(['init'])
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await writeFile(path.join(root, 'AGENTS.md'), 'Fixture rules: keep tests.\n')
  await git(['add', 'AGENTS.md'])
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=fixture@example.test',
    'commit',
    '--no-gpg-sign',
    '-m',
    'fixture'
  ])
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  const controller = new MissionController(db, store)
  const created = controller.createMission({
    repoId: 'repo',
    repoPath: root,
    targetBranch: 'main',
    goal,
    policy,
    provenance
  })
  missionId = created.mission.id
  goalRevisionId = created.goalRevision.id
  const plan = controller.proposePlan({
    missionId,
    planRevision: { ...makeProposal(), goalRevisionId },
    provenance
  })
  controller.approvePlan({ planRevisionId: plan.id, resolver: 'tester', provenance })
  const task = controller.listTasks({ missionId }).find((t) => t.spec.id === 'T04')
  if (!task) {
    throw new Error('fixture T04 missing')
  }
  taskId = task.taskId
  taskSpec = task.spec
  const context = await new ContextBuilder(
    store,
    new ArtifactStore(store, path.join(root, 'artifacts'))
  ).build({ missionId, taskId })
  contextPackageId = context.packageId
  installed = ['codex', 'claude', 'antigravity', 'claude-agent-teams']
  engine = new RulesEngine(PROVIDER_SELECTION_RULES)
  factory = new AgentFactory(store, engine, async () => installed)
})
afterEach(async () => {
  vi.restoreAllMocks()
  db?.close()
  await rm(root, { recursive: true, force: true })
})
const build = () => factory.build({ missionId, role: 'worker', taskId, contextPackageId })
const events = () =>
  store.listAuditEvents({ missionId }).filter((e) => e.event === 'agent_spec.created')
function routing(input: unknown) {
  const current = store.getPolicy(missionId)!
  store.upsertPolicy(missionId, { ...current, routing: RoutingPolicySchema.parse(input) })
}
function patchTask(patch: Partial<TaskSpec>) {
  db.db
    .prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?')
    .run(JSON.stringify({ ...taskSpec, ...patch }), taskId)
}

describe('AgentFactory', () => {
  it('content-addresses fixture T04 with one row and audit, preserving all other state', async () => {
    const before = store.getTaskStage(taskId)
    const first = await build()
    expect(await build()).toEqual(first)
    expect(first.id).toBe(`spec_${sha256(canonicalAgentSpec(first.spec))}`)
    expect(first.id).not.toBe(
      `spec_${sha256(canonicalAgentSpec(first.spec).replace('"endpointProfile":"subscription"', '"endpointProfile":"api-key:example"'))}`
    )
    expect(first.spec).toMatchObject({
      role: 'worker',
      provider: 'claude',
      model: 'policy-default',
      endpointProfile: 'subscription',
      acceptanceCriteria: ['Checks pass'],
      capabilities: ['src'],
      budget: { maxRuntimeMinutes: 120 },
      reasoning: { effort: 'medium' },
      permissions: { write: ['src/storage/'] },
      selection: {
        installed: ['claude', 'codex', 'antigravity'],
        chosen: 'claude',
        ranked: ['claude', 'codex', 'antigravity']
      }
    })
    expect(canonicalAgentSpec(first.spec)).not.toMatch(/maxAttempts|claude-agent-teams/)
    expect(store.listAgentSpecs(missionId)).toHaveLength(1)
    expect(store.getAgentSpec(first.id)?.spec).toEqual(first.spec)
    expect(store.getAgentSpec('missing')).toBeUndefined()
    expect(events()).toHaveLength(1)
    expect(events()[0].after).toEqual(first.spec.selection)
    expect(store.getTaskStage(taskId)).toEqual(before)
    expect(db.db.prepare('SELECT * FROM attempt_bindings').all()).toEqual([])
    installed = ['antigravity', 'claude', 'codex', 'claude']
    expect((await build()).id).toBe(first.id)
    if (process.env.AXIOM_SPEC_EXAMPLE) {
      await writeFile(
        path.join(process.env.AXIOM_SPEC_EXAMPLE, 'm2-03-spec-example.json'),
        JSON.stringify(first, null, 2)
      )
    }
  })
  it('persists and audits the D57 medium-risk certification selection', async () => {
    installed = ['claude', 'codex', 'gemini', 'antigravity', 'opencode']
    patchTask({ risk: 'medium' })
    const { id, spec } = await build()
    expect(spec.selection).toMatchObject({
      chosen: 'claude',
      ranked: ['claude', 'codex', 'antigravity'],
      filtered: [
        { provider: 'gemini', reason: 'not_certified' },
        { provider: 'opencode', reason: 'tier_too_low' }
      ]
    })
    expect(store.getAgentSpec(id)?.spec).toEqual(spec)
    expect(events()[0].after).toEqual(spec.selection)
  })
  it('applies high-risk tiers before preferences and carries Task budget overrides', async () => {
    routing({ preferredProviders: ['antigravity'], models: { claude: 'configured-model' } })
    patchTask({ risk: 'high', budget: { maxRuntimeMinutes: 9, maxTokens: 300 } })
    const { spec } = await build()
    expect(spec).toMatchObject({
      provider: 'claude',
      model: 'configured-model',
      reasoning: { effort: 'high' },
      budget: { maxRuntimeMinutes: 9, maxTokens: 300 }
    })
    expect(spec.selection.ranked).toEqual(['claude', 'codex'])
    expect(spec.selection.filtered).toContainEqual({
      provider: 'antigravity',
      reason: 'tier_too_low'
    })
  })
  it('changes identity with routing and records disallowed and unavailable candidates', async () => {
    const first = await build()
    routing({ disallowedProviders: ['codex'], preferredProviders: ['antigravity'] })
    const next = await build()
    expect(next.id).not.toBe(first.id)
    expect(next.spec.selection).toMatchObject({
      chosen: 'antigravity',
      ranked: ['antigravity', 'claude']
    })
    expect(next.spec.selection.filtered).toContainEqual({ provider: 'codex', reason: 'disallowed' })
    expect(next.spec.selection.filtered).toContainEqual({
      provider: 'opencode',
      reason: 'not_installed'
    })
    expect(store.listAgentSpecs(missionId)).toHaveLength(2)
  })
  it('fails without writes when nothing is eligible', async () => {
    installed = []
    await expect(build()).rejects.toMatchObject({
      code: 'no_eligible_provider',
      data: { installed: [] }
    })
    expect(store.listAgentSpecs(missionId)).toEqual([])
    expect(events()).toEqual([])
    installed = ['claude-agent-teams', 'antigravity']
    routing({ disallowedProviders: ['antigravity'] })
    await expect(build()).rejects.toMatchObject({ code: 'no_eligible_provider' })
    expect(events()).toEqual([])
  })
  it('makes read-only planner contracts with tier A only', async () => {
    routing({ preferredProviders: ['antigravity', 'codex'] })
    const { spec } = await factory.build({ missionId, role: 'planner', goalRevisionId })
    expect(spec).toMatchObject({
      role: 'planner',
      goalRevisionId,
      capabilities: ['planning'],
      provider: 'codex',
      endpointProfile: 'subscription',
      reasoning: { effort: 'medium' },
      permissions: { write: [] },
      workspace: { strategy: 'planner-worktree' }
    })
    expect(spec.selection.ranked).toEqual(['codex', 'claude'])
    expect(spec.selection.filtered).toContainEqual({
      provider: 'antigravity',
      reason: 'tier_too_low'
    })
    installed = ['antigravity']
    await expect(
      factory.build({ missionId, role: 'planner', goalRevisionId })
    ).rejects.toMatchObject({ code: 'no_eligible_provider' })
  })
  it('rejects missing or foreign Task, ContextPackage, GoalRevision and Mission references', async () => {
    await expect(
      factory.build({ missionId, role: 'worker', taskId: 'missing', contextPackageId })
    ).rejects.toMatchObject({ code: 'task_not_found' })
    await expect(
      factory.build({ missionId, role: 'worker', taskId, contextPackageId: 'missing' })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    db.db
      .prepare('UPDATE context_packages SET task_id = ? WHERE id = ?')
      .run('other', contextPackageId)
    await expect(build()).rejects.toMatchObject({ code: 'invalid_argument' })
    db.db.prepare('UPDATE task_stages SET mission_id = ? WHERE task_id = ?').run('other', taskId)
    await expect(build()).rejects.toMatchObject({ code: 'task_not_found' })
    await expect(
      factory.build({ missionId, role: 'planner', goalRevisionId: 'missing' })
    ).rejects.toMatchObject({ code: 'goal_revision_not_found' })
    db.db
      .prepare('UPDATE goal_revisions SET mission_id = ? WHERE id = ?')
      .run('other', goalRevisionId)
    await expect(
      factory.build({ missionId, role: 'planner', goalRevisionId })
    ).rejects.toMatchObject({ code: 'goal_revision_not_found' })
    db.db.prepare('DELETE FROM mission_policies WHERE mission_id = ?').run(missionId)
    await expect(build()).rejects.toMatchObject({ code: 'mission_not_found' })
    await expect(
      factory.build({ missionId: 'missing', role: 'planner', goalRevisionId })
    ).rejects.toMatchObject({ code: 'mission_not_found' })
    expect(events()).toEqual([])
  })
  it('rejects an engine that violates the eligible permutation', async () => {
    routing({ disallowedProviders: ['codex'] })
    vi.spyOn(engine, 'rank').mockReturnValue({
      ranked: ['codex', 'claude', 'antigravity'],
      confidence: 1,
      rationale: 'bad advice',
      engine: 'rules'
    })
    await expect(build()).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(store.listAgentSpecs(missionId)).toEqual([])
    expect(events()).toEqual([])
  })
  it('rolls back the row if its audit fails and rejects inconsistent stored indexes', async () => {
    const audit = vi.spyOn(store, 'appendAuditEvent').mockImplementation(() => {
      throw new Error('audit failure')
    })
    await expect(build()).rejects.toThrow('audit failure')
    expect(store.listAgentSpecs(missionId)).toEqual([])
    audit.mockRestore()
    const { id } = await build()
    db.db.prepare('UPDATE agent_specs SET provider = ? WHERE id = ?').run('codex', id)
    expect(() => store.getAgentSpec(id)).toThrow('Invalid stored AgentSpec')
  })
  it('derives sorted unique capabilities and falls back to the 45-minute default', async () => {
    const current = store.getPolicy(missionId)!
    store.upsertPolicy(missionId, { ...current, budget: { maxTokens: 123 } })
    patchTask({ scope: { allowedPaths: ['src/a.ts', 'docs/', 'src/b.ts'] } })
    expect((await build()).spec).toMatchObject({
      capabilities: ['docs', 'src'],
      budget: { maxRuntimeMinutes: 45, maxTokens: 123 }
    })
  })
})

it('chooses the worker channel without persisting a terminal contract first', async () => {
  installed = ['codex']
  const builder = new ContextBuilder(store, new ArtifactStore(store, path.join(root, 'artifacts')))
  const contexts = vi.spyOn(store, 'insertContextPackage')
  const specs = vi.spyOn(store, 'insertAgentSpec')
  const before = store.listAuditEvents({ missionId })
  expect(await factory.selectWorkerProvider({ missionId, taskId })).toBe('codex')
  expect(store.listAuditEvents({ missionId })).toEqual(before)
  expect(contexts).not.toHaveBeenCalled()
  expect(specs).not.toHaveBeenCalled()
  const result = await buildWorkerContracts(builder, factory, missionId, taskId)
  expect(contexts).toHaveBeenCalledOnce()
  expect(specs).toHaveBeenCalledOnce()
  expect(store.getAgentSpec(result.agentSpecId)?.spec).toMatchObject({
    contextPackageId: result.contextPackageId
  })
  expect(result.contextPackageId).not.toBe(contextPackageId)
})
it('refuses a provider change between selection and the final contract', async () => {
  installed = ['codex']
  const builder = new ContextBuilder(store, new ArtifactStore(store, path.join(root, 'artifacts')))
  const buildContext = builder.build.bind(builder)
  vi.spyOn(builder, 'build').mockImplementation(async (input) => {
    const result = await buildContext(input)
    installed = ['claude']
    return result
  })
  await expect(buildWorkerContracts(builder, factory, missionId, taskId)).rejects.toThrow(
    'provider changed during admission'
  )
})
