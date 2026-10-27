import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentSpecSchema } from '../../../shared/axiom-contract/agent-spec'
import {
  headlessClaudeCombination,
  claudeLaunchMismatches,
  recordClaudeLaunchObservation
} from './claude-worker-combination'
import * as version from './claude-worker-version'
import { prepareClaudeAttemptFiles, persistClaudeLastMessage } from './headless-attempt-files'
import { ClaudeInitSchema } from './claude-worker-events'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-claude-combination-'))
  vi.spyOn(version, 'claudeWorkerVersion').mockResolvedValue('2.1.309 (Claude Code)')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const spec = AgentSpecSchema.parse({
  version: 1,
  missionId: 'mission',
  role: 'worker',
  taskId: 'task',
  contextPackageId: 'ctx',
  provider: 'claude',
  model: 'policy-default',
  endpointProfile: 'subscription',
  reasoning: { effort: 'medium' },
  permissions: { write: ['src/'], network: 'restricted', tools: ['shell', 'git-readonly'] },
  budget: { maxRuntimeMinutes: 45 },
  submissionContract: 'axiom-submission-v1',
  acceptanceCriteria: [],
  capabilities: [],
  workspace: { strategy: 'attempt-worktree' },
  selection: {
    installed: ['claude'],
    filtered: [],
    ranked: ['claude'],
    chosen: 'claude',
    rationale: 'test'
  }
})
async function combination() {
  const skill = path.join(root, 'skills', 'allowed')
  await mkdir(skill, { recursive: true })
  await writeFile(path.join(skill, 'SKILL.md'), '# Allowed\n')
  const allowlist = { skills: ['allowed', 'missing'], mcpServers: [] }
  const files = await prepareClaudeAttemptFiles({
    directory: root,
    worktree: '/work',
    accountHomePath: root,
    allowlist
  })
  return headlessClaudeCombination({
    spec,
    homePath: root,
    allowlist,
    command: '/fake/claude',
    files,
    platform: 'darwin'
  })
}
it('records account skill identities, invocation hashes and credential location without reading credentials', async () => {
  const { combination: value, reasons } = await combination()
  expect(value).toMatchObject({
    requested: {
      harness: 'claude',
      channel: 'headless',
      model: 'policy-default',
      effort: 'medium',
      claudeConfigDir: 'selected-account',
      settingSources: [],
      syncedSkills: 'off',
      bundledSkills: 'off',
      plugins: 'off',
      mcp: 'strict'
    },
    effective: {
      harnessVersion: '2.1.309 (Claude Code)',
      claudeConfigDir: { kind: 'account', path: root },
      credentials: 'keychain',
      settingsSha256: expect.any(String),
      mcpConfigSha256: expect.any(String),
      accountSkills: [
        {
          name: 'allowed',
          path: path.join(root, 'skills', 'allowed'),
          digest: expect.stringMatching(/^[a-f0-9]{64}$/)
        }
      ]
    }
  })
  expect(reasons).toEqual(['skill_missing:missing'])
})
it('compares init with the request and prelaunch version, including aliases', () => {
  const requested = { model: 'opus', allowlist: { skills: ['allowed'], mcpServers: ['safe'] } }
  const effective = { harnessVersion: '2.1.309 (Claude Code)' }
  const init = ClaudeInitSchema.parse({
    type: 'system',
    subtype: 'init',
    claude_code_version: '2.1.309',
    model: 'claude-opus-5',
    permissionMode: 'acceptEdits',
    skills: ['allowed'],
    mcp_servers: [{ name: 'safe' }]
  })
  expect(claudeLaunchMismatches(init, { requested, effective })).toEqual([])
  expect(
    claudeLaunchMismatches(
      {
        ...init,
        claude_code_version: '2.2.0',
        model: 'claude-sonnet-5',
        permissionMode: 'auto',
        skills: ['unlisted'],
        plugins: [{ name: 'plugin' }],
        mcp_servers: [{ name: 'other' }]
      },
      { requested, effective }
    )
  ).toEqual([
    'skill_unexpected:unlisted',
    'plugin_unexpected:plugin',
    'mcp_server_unexpected:other',
    'permission_mode_unexpected',
    'model_unexpected',
    'harness_version_changed'
  ])
})
it('records init observations once across polling/recovery', async () => {
  const f = planned(fixture())
  try {
    const { combination: value } = await combination()
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'test',
      objectKind: 'attempt',
      objectId: 'dispatch',
      event: 'attempt.headless_prepared',
      before: null,
      after: { combination: value }
    })
    const init = ClaudeInitSchema.parse({
      type: 'system',
      subtype: 'init',
      model: 'claude-opus-5',
      permissionMode: 'acceptEdits',
      claude_code_version: '2.1.309',
      skills: ['unexpected']
    })
    for (let i = 0; i < 2; i++) {
      recordClaudeLaunchObservation(f.store, f.missionId, 'dispatch', init)
    }
    const events = f.store.listAuditEvents({ missionId: f.missionId })
    expect(events.filter((event) => event.event === 'attempt.launch_observed')).toHaveLength(1)
    expect(events.filter((event) => event.event === 'attempt.launch_mismatch')).toMatchObject([
      { after: { reasons: ['skill_unexpected:unexpected'] } }
    ])
  } finally {
    f.db.close()
  }
})
it('extracts only the Claude result into a private last-message file', async () => {
  await persistClaudeLastMessage(root, 'claude', { lastMessage: 'final report' })
  expect(await readFile(path.join(root, 'last-message.md'), 'utf8')).toBe('final report')
  await persistClaudeLastMessage(root, 'codex', { lastMessage: 'must not overwrite Codex' })
  expect(await readFile(path.join(root, 'last-message.md'), 'utf8')).toBe('final report')
})
it('replaces a Worker-created report symlink without changing its target', async () => {
  const target = path.join(root, 'unrelated.md')
  await writeFile(target, 'preserved')
  await symlink(target, path.join(root, 'last-message.md'))
  await persistClaudeLastMessage(root, 'claude', { lastMessage: 'final report' })
  expect(await readFile(target, 'utf8')).toBe('preserved')
  expect(await readFile(path.join(root, 'last-message.md'), 'utf8')).toBe('final report')
})
