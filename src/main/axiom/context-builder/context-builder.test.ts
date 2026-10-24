import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  goal,
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { canonicalContextManifest } from '../../../shared/axiom-contract/context-package'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import * as generated from '../../runtime/orchestration/db/generated-id'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from '../mission-controller/mission-controller'
import { ArtifactStore, sha256 } from '../artifacts/artifact-store'
import { ContextBuilder } from './context-builder'
import { readRepositoryRules } from './repository-rules'
import { redactContext } from './redaction'

let root: string
let db: OrchestrationDb
let store: AxiomStore
let artifacts: ArtifactStore
let builder: ContextBuilder
let missionId: string
let taskId: string
let upstream: string[]
let controller: MissionController
const sections = [
  'Task spec',
  'PlanRevision summary',
  'ACCEPTED Decisions',
  'Permissions, budget and submission contract',
  'Repository rules',
  'Required verification commands',
  'Previous-Attempt failure evidence'
]
const git = (args: string[]) => gitExecFileAsync(args, gitOptionsForWorktree(root))

beforeEach(async () => {
  let next = 0
  vi.spyOn(generated, 'generateId').mockImplementation(
    (prefix) => `${prefix}_${String(++next).padStart(12, '0')}`
  )
  root = await mkdtemp(path.join(tmpdir(), 'axiom-context-'))
  await git(['init'])
  await git(['symbolic-ref', 'HEAD', 'refs/heads/main'])
  await writeFile(path.join(root, 'AGENTS.md'), 'Target branch rules: keep tests.\n')
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
  controller = new MissionController(db, store)
  const created = controller.createMission({
    repoId: 'repo',
    repoPath: root,
    targetBranch: 'main',
    goal,
    provenance
  })
  missionId = created.mission.id
  const plan = controller.proposePlan({
    missionId,
    planRevision: { ...makeProposal(), goalRevisionId: created.goalRevision.id },
    provenance
  })
  controller.approvePlan({ planRevisionId: plan.id, resolver: 'tester', provenance })
  const tasks = controller.listTasks({ missionId })
  const task = tasks.find((t) => t.spec.id === 'T04')
  if (!task) {
    throw new Error('fixture T04 missing')
  }
  taskId = task.taskId
  upstream = store.listUpstreamEdges(taskId).map((edge) => edge.fromTaskId)
  artifacts = new ArtifactStore(store, path.join(root, 'artifacts'))
  builder = new ContextBuilder(store, artifacts)
})
afterEach(async () => {
  vi.restoreAllMocks()
  db?.close()
  await rm(root, { recursive: true, force: true })
})

function put(
  content: string,
  related = upstream.slice(0, 1),
  kind: 'handoff' | 'worker_report' | 'log' = 'handoff'
) {
  return artifacts.put({
    missionId,
    kind,
    content: Buffer.from(content),
    mediaType: 'text/plain',
    related,
    createdBy: 'fixture-worker'
  })
}

describe('ContextBuilder', () => {
  it('renders the Candidate contract for Workers and path semantics for Planners', async () => {
    const worker = await builder.build({ missionId, taskId })
    expect(worker.renderTemplate).toContain(
      'Every file left in this worktree becomes part of the Candidate. Write reports and other Artifact files outside the worktree (for example in a temporary directory) before running axiom mission artifact put.'
    )
    expect(worker.renderTemplate).toContain(
      'Verification compares the Candidate with its merge-base on the integration branch: a changed path outside allowedPaths fails it (scope_violation), an added line that matches a secret pattern fails it (secret_detected), and changes to dependency manifests, lockfiles, CI, hooks, test or lint configuration or agent instruction files go to human review unless an allowedPaths entry names them.'
    )
    const planner = await builder.build({
      missionId,
      role: 'planner',
      goalRevisionId: store.getMission(missionId)!.activeGoalRevisionId!
    })
    expect(planner.renderTemplate).toContain(
      'scope.allowedPaths entries are repository-relative: an entry covers that path and everything below it; * and ? match within one path segment, ** matches any number of segments, and . is the whole repository. Verification fails any change outside allowedPaths.'
    )
    expect(planner.renderTemplate).toContain(
      'Name dependency manifests, lockfiles, CI workflows, hooks, test or lint configuration and agent instruction files (AGENTS.md, CLAUDE.md, .claude/, .codex/, .agents/, .mcp.json) in allowedPaths when a Task must change them; otherwise such a change goes to human review.'
    )
  })

  it('renders the same ordered plan as independent verification', async () => {
    const task = store.getTaskStage(taskId)!
    const policy = store.getPolicy(missionId)!
    store.upsertPolicy(missionId, {
      ...policy,
      verificationRules: {
        setupCommands: ['setup'],
        repositoryGates: { [task.spec.risk]: [...task.spec.requiredEvidence, 'gate'] }
      }
    })
    const { renderTemplate } = await builder.build({ missionId, taskId })
    expect(renderTemplate).toContain(
      `## Required verification commands\n\n${['setup', ...new Set(task.spec.requiredEvidence), 'gate'].join('\n')}`
    )
  })
  it('builds context with a human-escalation notice for invalid stored verification rules', async () => {
    store.upsertPolicy(missionId, {
      ...store.getPolicy(missionId)!,
      verificationRules: { commands: ['pnpm test', 'pnpm tc'] }
    })
    const { renderTemplate } = await builder.build({ missionId, taskId })
    expect(renderTemplate).toContain(
      '## Required verification commands\n\nVerification rules are invalid (policy_invalid); the independent verifier will escalate to a human.'
    )
  })
  it('pins the T04 manifest identity and reproduces without writes', async () => {
    await put('Sprint validation handoff.', [upstream[0]])
    await put('CSV interchange report.', [upstream[1]], 'worker_report')
    const first = await builder.build({ missionId, taskId })
    expect(upstream).toHaveLength(2)
    expect(first.packageId).toBe(
      'ctx_80cde191f3e0ee147e40801bdaa23bf72bf1c779ef9fd417bf7aad59f21eaf13'
    )
    expect(first.manifest.mandatory.map((entry) => entry.section)).toEqual(sections)
    expect(first.packageId).toBe(`ctx_${sha256(canonicalContextManifest(first.manifest))}`)
    const rows = store.listArtifacts({ missionId })
    const files = await readdir(path.join(root, 'artifacts'))
    const writes = vi.spyOn(store, 'insertArtifact')
    const packages = vi.spyOn(store, 'insertContextPackage')
    expect(await builder.build({ missionId, taskId })).toEqual(first)
    expect(writes).not.toHaveBeenCalled()
    expect(packages).not.toHaveBeenCalled()
    expect(store.listArtifacts({ missionId })).toEqual(rows)
    expect(await readdir(path.join(root, 'artifacts'))).toEqual(files)
    const saved = store.getContextPackage(first.packageId)
    expect(saved?.manifest).toEqual(first.manifest)
    expect(saved?.mandatoryRefs).toHaveLength(2)
    const render = rows.find((row) => row.kind === 'context_package_render')
    const manifest = rows.find((row) => row.kind === 'context_package_manifest')
    expect((await artifacts.read(render!.id)).content.toString()).toBe(first.renderTemplate)
    expect((await artifacts.read(manifest!.id)).content.toString()).toBe(
      canonicalContextManifest(first.manifest)
    )
    if (process.env.AXIOM_CONTEXT_EXAMPLE) {
      await writeFile(
        path.join(process.env.AXIOM_CONTEXT_EXAMPLE, 'm2-02-context-example.json'),
        JSON.stringify(first, null, 2)
      )
    }
  })

  it('drops ranked candidates before any mandatory section, even at zero budget', async () => {
    const candidate = await put('needed handoff')
    const result = await builder.build({ missionId, taskId, tokenBudget: 0 })
    expect(result.manifest.mandatory.map((entry) => entry.section)).toEqual(sections)
    expect(result.manifest.budgetExceededByMandatory).toBe(true)
    expect(result.manifest.ranked).toEqual([])
    expect(result.manifest.omitted).toEqual([{ artifactId: candidate.id, reason: 'budget' }])
    for (const section of sections) {
      expect(result.renderTemplate).toContain(`## ${section}`)
    }
  })

  it('reads target-branch rules and omits missing CLAUDE.md, ignoring the working tree', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), 'Uncommitted rules must not leak')
    await writeFile(path.join(root, 'CLAUDE.md'), 'Untracked rules must not leak')
    await writeFile(path.join(root, '.env'), 'Never read this')
    const { renderTemplate } = await builder.build({ missionId, taskId })
    expect(renderTemplate).toContain('Target branch rules: keep tests.')
    expect(renderTemplate).not.toMatch(/Uncommitted|Untracked|Never read this/)
    expect(renderTemplate).toContain('## Required verification commands\n\nTest report')
  })

  it('redacts candidate credentials and a target-branch private key before hashing/rendering', async () => {
    const secret = `ghp_${'synthetic'.repeat(4)}`
    const candidate = await put(`Report token ${secret}; done.`)
    const key = [
      '-----BEGIN PRIVATE KEY-----',
      'synthetic-key-body',
      '-----END PRIVATE KEY-----'
    ].join('\n')
    await writeFile(path.join(root, 'AGENTS.md'), `Rules\n${key}\nSafe rule`)
    await git(['add', 'AGENTS.md'])
    await git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--no-gpg-sign',
      '-m',
      'redaction fixture'
    ])
    const result = await builder.build({ missionId, taskId })
    expect(result.renderTemplate).not.toContain(secret)
    expect(result.renderTemplate).not.toContain('synthetic-key-body')
    expect(result.renderTemplate).toContain('[REDACTED]')
    expect(result.renderTemplate).toContain('AGENTS.md [redacted]')
    expect(result.manifest.omitted).toContainEqual({ artifactId: candidate.id, reason: 'redacted' })
    expect(result.manifest.ranked[0].sha256).not.toBe(candidate.sha256)
  })

  it('ranks direct upstream artifacts in edge order and created_at/id order without duplicates', async () => {
    const second = await put('second dependency', [upstream[1]])
    const first = await put('first dependency', [upstream[0], upstream[1]])
    await put('unrelated', [taskId])
    await put('ignored log', [upstream[0]], 'log')
    const result = await builder.build({ missionId, taskId })
    expect(result.manifest.ranked.map((r) => r.artifactId)).toEqual([first.id, second.id])
    expect(result.renderTemplate).toContain('Sprint validation')
    expect(result.renderTemplate).toContain('CSV interchange')
    expect(result.renderTemplate).toContain('Sprint lifecycle')
  })

  it('renders the D16 protocol with only delivery-time placeholders', async () => {
    const { renderTemplate } = await builder.build({ missionId, taskId })
    for (const verb of [
      'submit',
      'ask',
      'blocked',
      'handoff',
      'inform',
      'request',
      'request-subtask',
      'check'
    ]) {
      expect(renderTemplate).toContain(`axiom attempt ${verb} --attempt {{attemptId}}`)
    }
    expect(renderTemplate).toContain(`axiom mission artifact put --mission ${missionId}`)
    expect(renderTemplate).toContain(`--related ${taskId}`)
    expect(renderTemplate).not.toMatch(/dcap_|dispatch_[a-f0-9]/)
    expect(renderTemplate).toContain('axiom-submission-v1')
    expect(renderTemplate).toContain('none (first attempt)')
  })

  it('uses configured verification commands and optional stored contextTokens', async () => {
    db.db
      .prepare(
        'UPDATE mission_policies SET budget = ?, verification_rules = ? WHERE mission_id = ?'
      )
      .run('{"contextTokens":42}', '{"repositoryGates":{"low":["pnpm test","pnpm tc"]}}', missionId)
    const result = await builder.build({ missionId, taskId })
    expect(result.manifest.tokenBudget).toBe(42)
    expect(result.renderTemplate).toContain('pnpm tc')
    db.db
      .prepare('UPDATE mission_policies SET verification_rules = ? WHERE mission_id = ?')
      .run('{"commands":"invalid"}', missionId)
    const legacy = await builder.build({ missionId, taskId })
    expect(legacy.manifest.tokenBudget).toBe(42)
    expect(legacy.renderTemplate).toContain(
      'Verification rules are invalid (policy_invalid); the independent verifier will escalate to a human.'
    )
  })

  it('rejects cross-Mission Tasks and propagates corrupt candidate evidence', async () => {
    const other = controller.createMission({
      repoId: 'other',
      repoPath: root,
      targetBranch: 'main',
      goal,
      provenance
    })
    await expect(builder.build({ missionId: other.mission.id, taskId })).rejects.toThrow(
      'task_mission_mismatch'
    )
    const candidate = await put('handoff')
    await writeFile(artifacts.pathFor(candidate.sha256), 'corrupt')
    await expect(builder.build({ missionId, taskId })).rejects.toMatchObject({
      code: 'artifact_corrupt'
    })
  })

  it('includes only this Mission’s ACCEPTED Decisions and changes identity on resolution changes', async () => {
    const insert = db.db.prepare(
      'INSERT INTO decisions (id, mission_id, status, title, resolution, authority) VALUES (?, ?, ?, ?, ?, ?)'
    )
    insert.run('accepted', missionId, 'ACCEPTED', 'Use CLI', 'Use the Axiom CLI', 'user')
    insert.run('pending', missionId, 'PROPOSED', 'Pending title', 'Pending resolution', 'user')
    insert.run('foreign', 'other', 'ACCEPTED', 'Foreign title', 'Foreign resolution', 'user')
    const first = await builder.build({ missionId, taskId })
    expect(first.renderTemplate).toContain('Use the Axiom CLI')
    expect(first.renderTemplate).not.toMatch(/Pending title|Foreign title/)
    db.db
      .prepare('UPDATE decisions SET resolution = ? WHERE id = ?')
      .run('Use CLI with evidence', 'accepted')
    expect((await builder.build({ missionId, taskId })).packageId).not.toBe(first.packageId)
  })

  it('caps repository rules after redaction and rejects an unreadable target branch', async () => {
    await writeFile(path.join(root, 'AGENTS.md'), '✓'.repeat(10_000))
    await writeFile(path.join(root, 'CLAUDE.md'), 'Companion rules')
    await git(['add', 'AGENTS.md', 'CLAUDE.md'])
    await git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.test',
      'commit',
      '--no-gpg-sign',
      '-m',
      'large rules'
    ])
    const rules = await readRepositoryRules(root, 'main')
    expect(rules).toContain('[capped at 16 KiB]')
    expect(rules).toContain('Companion rules')
    expect(rules).not.toContain('\uFFFD')
    const agents = rules.split('\n\n### CLAUDE.md')[0].split('\n').slice(1).join('\n')
    expect(Buffer.byteLength(agents)).toBeLessThanOrEqual(16 * 1024)
    await expect(readRepositoryRules(root, 'missing-branch')).rejects.toThrow(
      'context_repository_unavailable'
    )
  })

  it('redacts every specified credential pattern including underscore tokens', () => {
    for (const prefix of [
      'sk-',
      'ghp-',
      'ghp_',
      'gho_',
      'github_pat_',
      'xoxa-',
      'xoxb-',
      'xoxp-'
    ]) {
      expect(redactContext(`${prefix}${'fake'.repeat(5)}`)).toEqual({
        content: '[REDACTED]',
        redacted: true
      })
    }
    expect(redactContext(`AKIA${'A'.repeat(16)}`).content).toBe('[REDACTED]')
    expect(redactContext('Safe context')).toEqual({ content: 'Safe context', redacted: false })
  })
})
