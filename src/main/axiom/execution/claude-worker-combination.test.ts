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
import { claudeManagedSettingsSha256 } from './claude-launch-policy'
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
  const allowlist = { skills: ['ignored-home-skill'], mcpServers: [] }
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
const launchBaseline = {
  harnessVersion: '2.1.309',
  skills: ['doctor', 'plugin-authoring'],
  evidence: '.axiom-work/verifications/M3-08f-isolation-probe.md'
}
it('snapshots only surface names and kinds without following links or scanning packages', async () => {
  // A dangling link must remain a link; no child contents or linked paths enter the evidence.
  await symlink(path.join(root, 'absent-target'), path.join(root, 'skills'))
  await mkdir(path.join(root, 'commands'))
  await writeFile(path.join(root, 'settings.json'), 'not parsed')
  const { combination: value, reasons } = await combination()
  expect(value.requested).toMatchObject({
    harness: 'claude',
    channel: 'headless',
    policyTier: 'axiom',
    launchBaseline,
    allowlist: { skills: [], mcpServers: [] },
    settingSources: []
  })
  expect(value.effective).toMatchObject({
    harnessVersion: '2.1.309 (Claude Code)',
    claudeConfigDir: { kind: 'account', path: root },
    credentials: 'keychain',
    managedSettingsSha256: claudeManagedSettingsSha256('worker'),
    settingsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    mcpConfigSha256: expect.stringMatching(/^[a-f0-9]{64}$/)
  })
  expect(value.effective.accountHome.surfaces).toEqual([
    { name: 'skills', kind: 'link' },
    { name: 'commands', kind: 'dir' },
    { name: 'agents', kind: 'absent' },
    { name: 'plugins', kind: 'absent' },
    { name: 'hooks', kind: 'absent' },
    { name: 'settings.json', kind: 'file' },
    { name: '.claude.json', kind: 'absent' },
    { name: '.mcp.json', kind: 'absent' }
  ])
  expect(value.effective).not.toHaveProperty('accountSkills')
  expect(reasons).toEqual([])
})
it('compares init with the request and prelaunch version, including aliases', () => {
  const requested = {
    model: 'opus',
    launchBaseline,
    allowlist: { skills: ['allowed'], mcpServers: ['safe'] }
  }
  const effective = { harnessVersion: '2.1.309 (Claude Code)' }
  const init = ClaudeInitSchema.parse({
    type: 'system',
    subtype: 'init',
    claude_code_version: '2.1.309',
    model: 'claude-opus-5',
    permissionMode: 'acceptEdits',
    skills: ['allowed', 'doctor', 'plugin-authoring'],
    plugins: [
      { name: 'cc-plugin-agents-md', path: 'builtin' },
      { name: 'cc-plugin-sec-default', path: 'builtin' }
    ],
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
        plugins: [{ name: 'plugin', path: '/outside/plugin' }],
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
    'harness_version_changed',
    'harness_baseline_stale:2.2.0'
  ])
})
it('reports a stale or missing recorded baseline without changing the prelaunch version check', () => {
  const init = ClaudeInitSchema.parse({
    type: 'system',
    subtype: 'init',
    model: 'opus',
    permissionMode: 'acceptEdits',
    claude_code_version: '2.1.312 (Claude Code)'
  })
  const requested = { model: 'opus', allowlist: { skills: [], mcpServers: [] } }
  const effective = { harnessVersion: '2.1.312 (Claude Code)' }
  expect(
    claudeLaunchMismatches(init, { requested: { ...requested, launchBaseline }, effective })
  ).toEqual(['harness_baseline_stale:2.1.312'])
  for (const baseline of [requested, { ...requested, launchBaseline: null }]) {
    expect(claudeLaunchMismatches(init, { requested: baseline, effective })).toEqual([
      'harness_baseline_missing'
    ])
  }
})
it.each([false, true])(
  'records init once across polling/recovery; custom plugin = %s',
  async (customPlugin) => {
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
        skills: ['doctor', 'plugin-authoring'],
        plugins: customPlugin
          ? [{ name: 'external-plugin', path: '/outside/plugin' }]
          : [{ name: 'cc-plugin-agents-md', path: 'builtin' }]
      })
      for (let i = 0; i < 2; i++) {
        recordClaudeLaunchObservation(f.store, f.missionId, 'dispatch', init)
      }
      const events = f.store.listAuditEvents({ missionId: f.missionId })
      expect(events.filter((event) => event.event === 'attempt.launch_observed')).toHaveLength(1)
      expect(events.filter((event) => event.event === 'attempt.launch_mismatch')).toMatchObject(
        customPlugin ? [{ after: { reasons: ['plugin_unexpected:external-plugin'] } }] : []
      )
    } finally {
      f.db.close()
    }
  }
)
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
