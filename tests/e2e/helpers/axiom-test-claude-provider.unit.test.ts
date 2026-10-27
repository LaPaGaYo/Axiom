import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  AXIOM_TEST_CLAUDE_DENIED_TOOLS,
  AXIOM_TEST_CLAUDE_ENV,
  AXIOM_TEST_CLAUDE_MODEL,
  AXIOM_TEST_CLAUDE_PROVIDER_SOURCE,
  AXIOM_TEST_CLAUDE_VERSION
} from './axiom-test-claude-provider'
import { AXIOM_T01_FIXTURE_FILES } from './axiom-t01-fixture'
import { parseHeadlessReport } from '../../../src/main/axiom/execution/headless-worker-events'

const source = process.env.AXIOM_FIXTURE_REPO
const scratch: string[] = []
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function providerFixture() {
  const directory = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'axiom-claude-provider-')))
  scratch.push(directory)
  const provider = path.join(directory, 'provider.cjs')
  writeFileSync(provider, AXIOM_TEST_CLAUDE_PROVIDER_SOURCE)
  const run = (args: string[], options: Parameters<typeof spawnSync>[2] = {}) =>
    spawnSync(process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath, [provider, ...args], {
      encoding: 'utf8',
      timeout: 30_000,
      ...options
    })
  return { directory, run }
}

it('emits syntactically valid Claude provider JavaScript', () => {
  expect(() => new Function(AXIOM_TEST_CLAUDE_PROVIDER_SOURCE)).not.toThrow()
})

it('reports a Claude Code version and refuses the Agent SDK handshake', () => {
  const { run } = providerFixture()
  const version = run(['--version'])
  expect(version.status).toBe(0)
  expect(version.stdout).toBe(`${AXIOM_TEST_CLAUDE_VERSION} (Claude Code)\n`)
  const handshake = run(['--input-format', 'stream-json', '--output-format', 'stream-json', '-p'])
  expect(handshake.status).toBe(2)
  expect(handshake.stderr).toContain('unsupported SDK --input-format')
})

it.skipIf(!source)(
  'validates the launch contract and emits a host-submittable T01 result',
  () => {
    const { directory, run } = providerFixture()
    const worktree = path.join(directory, 'fixture')
    const cloned = spawnSync('git', ['clone', '--quiet', '--no-hardlinks', source!, worktree], {
      encoding: 'utf8'
    })
    expect(cloned.status, cloned.stderr).toBe(0)
    const checkedOut = spawnSync(
      'git',
      ['-C', worktree, 'checkout', '--quiet', 'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642'],
      { encoding: 'utf8' }
    )
    expect(checkedOut.status, checkedOut.stderr).toBe(0)
    const attemptDir = path.join(directory, 'attempt')
    mkdirSync(attemptDir)
    const settingsPath = path.join(attemptDir, 'claude-settings.json')
    const mcpPath = path.join(attemptDir, 'claude-mcp.json')
    writeFileSync(
      settingsPath,
      JSON.stringify({
        permissions: {
          allow: [
            'Read',
            'Grep',
            'Glob',
            'LS',
            `Edit(/${worktree}/**)`,
            `Edit(/${attemptDir}/**)`,
            `Write(/${worktree}/**)`,
            `Write(/${attemptDir}/**)`,
            `MultiEdit(/${worktree}/**)`,
            `MultiEdit(/${attemptDir}/**)`,
            `NotebookEdit(/${worktree}/**)`,
            `NotebookEdit(/${attemptDir}/**)`,
            'Bash'
          ],
          deny: AXIOM_TEST_CLAUDE_DENIED_TOOLS
        },
        sandbox: {
          enabled: true,
          failIfUnavailable: true,
          autoAllowBashIfSandboxed: true,
          allowUnsandboxedCommands: false,
          network: { allowedDomains: [], allowLocalBinding: false, strictAllowlist: true },
          filesystem: { allowWrite: [worktree, attemptDir] }
        },
        syncClaudeAiSkills: false,
        syncClaudeAiPlugins: false,
        enabledPlugins: {}
      }),
      { mode: 0o600 }
    )
    writeFileSync(mcpPath, JSON.stringify({ mcpServers: {} }))
    const argv = [
      '-p',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--permission-prompts',
      'none',
      '--setting-sources=',
      '--settings',
      settingsPath,
      '--strict-mcp-config',
      '--mcp-config',
      mcpPath,
      '--disallowedTools',
      AXIOM_TEST_CLAUDE_DENIED_TOOLS.join(','),
      '--model',
      AXIOM_TEST_CLAUDE_MODEL,
      '--effort',
      'medium'
    ]
    const options = {
      cwd: worktree,
      input: 'Mission: mission-1\nTask: task-1\nAttempt: attempt-1\n',
      env: {
        ...process.env,
        ...AXIOM_TEST_CLAUDE_ENV,
        AXIOM_E2E_LEDGER: path.join(directory, 'ledger.jsonl'),
        CLAUDE_CONFIG_DIR: path.join(directory, 'claude-profiles', 'e2e-claude', 'home')
      }
    }
    const missingPin = run(
      argv.filter((arg) => arg !== '--strict-mcp-config'),
      options
    )
    expect(missingPin.status).not.toBe(0)
    expect(String(missingPin.stderr)).toContain('Missing pin --strict-mcp-config')
    const result = run(argv, options)
    expect(result.status, String(result.stderr)).toBe(0)
    const events = String(result.stdout)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events.map((event) => event.type)).toEqual(['system', 'assistant', 'result'])
    expect(events[0]).toMatchObject({
      subtype: 'init',
      claude_code_version: AXIOM_TEST_CLAUDE_VERSION,
      model: AXIOM_TEST_CLAUDE_MODEL
    })
    expect(events[2]).toMatchObject({
      subtype: 'success',
      is_error: false,
      total_cost_usd: 0.001,
      permission_denials: [],
      usage: { input_tokens: 100, cache_read_input_tokens: 40, output_tokens: 25 }
    })
    const report = parseHeadlessReport(events[2].result)
    expect(report.summary).toBe('Frozen fixture T01: Sprint entity and validation')
    expect(report.artifacts).toEqual([
      { path: '.axiom/artifacts/REPORT.md', kind: 'worker_report', mediaType: 'text/markdown' }
    ])
    for (const [file, contents] of Object.entries(AXIOM_T01_FIXTURE_FILES)) {
      expect(readFileSync(path.join(worktree, file), 'utf8')).toBe(contents)
    }
  },
  60_000
)
