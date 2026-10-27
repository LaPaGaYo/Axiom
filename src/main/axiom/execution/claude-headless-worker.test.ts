import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { buildHeadlessWorkerCommand, hasHeadlessWorkerBuilder } from './headless-worker-command'
import { prepareClaudeAttemptFiles } from './headless-attempt-files'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-claude-test-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it.each(['darwin', 'linux'] as const)('pins the Claude headless command on %s', (platform) => {
  const launch = buildHeadlessWorkerCommand({
    provider: 'claude',
    model: 'policy-default',
    effort: 'xhigh',
    platform,
    worktree: '/work tree',
    attemptDir: '/host/attempt',
    commandOverride: "'/fake claude'",
    accountHomePath: '/selected/home'
  })!
  expect(hasHeadlessWorkerBuilder('claude', platform)).toBe(true)
  expect(launch.argv.slice(0, 9)).toEqual([
    '/fake claude',
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--permission-prompts',
    'none'
  ])
  expect(launch.argv).toContain('--setting-sources=')
  expect(launch.argv).toContain('--strict-mcp-config')
  expect(launch.argv).toContain('/host/attempt/claude-settings.json')
  expect(launch.argv).toContain('/host/attempt/claude-mcp.json')
  expect(launch.argv).toContain('--disallowedTools')
  expect(launch.argv).toContain('xhigh')
  expect(launch.argv).not.toContain('--model')
  expect(launch.argv).not.toContain('--max-turns')
  expect(launch.stdinPath).toBe('/host/attempt/prompt.md')
  expect(launch.env).toEqual({
    CLAUDE_CONFIG_DIR: '/selected/home',
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    DISABLE_AUTOUPDATER: '1',
    DISABLE_TELEMETRY: '1',
    DISABLE_ERROR_REPORTING: '1',
    DISABLE_BUG_COMMAND: '1',
    CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1'
  })
})
it('uses catalog model/effort flags and rejects unsafe overrides', () => {
  const input = {
    provider: 'claude',
    model: 'opus',
    effort: 'high',
    worktree: '/work',
    attemptDir: root
  }
  expect(
    buildHeadlessWorkerCommand({ ...input, commandOverride: '/fake/claude' })?.argv.slice(-4)
  ).toEqual(['--model', 'opus', '--effort', 'high'])
  expect(() => buildHeadlessWorkerCommand({ ...input, commandOverride: 'claude --extra' })).toThrow(
    /override/
  )
  expect(buildHeadlessWorkerCommand({ ...input, platform: 'win32' })).toBeNull()
})
it('writes private isolation settings and only allowlisted MCP definitions without altering the home', async () => {
  const home = path.join(root, 'home')
  await mkdir(home)
  const config = JSON.stringify({
    mcpServers: { allowed: { command: '/allowed' }, other: { command: '/other' } }
  })
  await writeFile(path.join(home, '.claude.json'), config)
  const result = await prepareClaudeAttemptFiles({
    directory: root,
    worktree: '/work',
    accountHomePath: home,
    allowlist: { skills: [], mcpServers: ['allowed', 'missing'] }
  })
  const settings = JSON.parse(await readFile(path.join(root, 'claude-settings.json'), 'utf8'))
  expect(settings).toMatchObject({
    permissions: {
      allow: [
        'Read',
        'Grep',
        'Glob',
        'LS',
        'Edit(//work/**)',
        `Edit(/${root}/**)`,
        'Write(//work/**)',
        `Write(/${root}/**)`,
        'MultiEdit(//work/**)',
        `MultiEdit(/${root}/**)`,
        'NotebookEdit(//work/**)',
        `NotebookEdit(/${root}/**)`,
        'Bash'
      ],
      deny: expect.arrayContaining(['WebFetch', 'WebSearch', 'Agent'])
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false },
      filesystem: { allowWrite: ['/work', root] }
    },
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    enabledPlugins: {}
  })
  expect(settings).not.toHaveProperty('hooks')
  expect(settings).not.toHaveProperty('env')
  expect(JSON.parse(await readFile(path.join(root, 'claude-mcp.json'), 'utf8'))).toEqual({
    mcpServers: { allowed: { command: '/allowed' } }
  })
  expect(result.missingMcpServers).toEqual(['missing'])
  expect(result.settingsSha256).toMatch(/^[a-f0-9]{64}$/)
  expect(result.mcpConfigSha256).toMatch(/^[a-f0-9]{64}$/)
  for (const name of ['claude-settings.json', 'claude-mcp.json']) {
    expect((await stat(path.join(root, name))).mode & 0o777).toBe(0o600)
  }
  expect(await readFile(path.join(home, '.claude.json'), 'utf8')).toBe(config)
})
it('does not inspect the account config for an empty MCP allowlist', async () => {
  await prepareClaudeAttemptFiles({
    directory: root,
    worktree: '/work',
    accountHomePath: '/absent/home',
    allowlist: { skills: [], mcpServers: [] }
  })
  expect(JSON.parse(await readFile(path.join(root, 'claude-mcp.json'), 'utf8'))).toEqual({
    mcpServers: {}
  })
})
