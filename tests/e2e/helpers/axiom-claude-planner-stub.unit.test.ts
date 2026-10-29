import { query } from '@anthropic-ai/claude-agent-sdk'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAxiomClaudePlannerStub } from './axiom-claude-planner-stub'
import {
  AXIOM_TEST_CLAUDE_ENV,
  AXIOM_TEST_CLAUDE_PLANNER_POLICY
} from './axiom-test-claude-provider'
import { fixturePlanProposal } from './fixture-plan-proposal'

const source = process.env.AXIOM_FIXTURE_REPO
const scratch: string[] = []
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.each(['joined', 'separate'])('redacts MCP env values from %s argv in the ledger', (form) => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'axiom-planner-ledger-'))
  scratch.push(directory)
  const ledger = path.join(directory, 'ledger.jsonl')
  const sentinel = 'synthetic-ledger-env-value'
  const config = {
    mcpServers: {
      axiom: {
        type: 'stdio',
        command: process.execPath,
        args: ['attempt', 'mcp', '--mission', 'mission-1', '--attempt', 'attempt-1'],
        env: { AXIOM_E2E_SYNTHETIC: sentinel }
      }
    }
  }
  const configArgs =
    form === 'joined'
      ? [`--mcp-config=${JSON.stringify(config)}`]
      : ['--mcp-config', JSON.stringify(config)]
  const result = spawnSync(
    process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
    [path.resolve('tests/e2e/fixtures/axiom-claude-planner-stub.cjs'), ...configArgs],
    {
      encoding: 'utf8',
      timeout: 10_000,
      env: { AXIOM_E2E_LEDGER: ledger, ORCA_BACKGROUND_LAUNCH: '1' },
      input: `${JSON.stringify({
        type: 'control_request',
        request_id: 'initialize-1',
        request: { subtype: 'initialize' }
      })}\n`
    }
  )
  expect(result.status).toBe(0)
  const text = readFileSync(ledger, 'utf8')
  expect(text.includes(sentinel)).toBe(false)
  const launch = JSON.parse(text.trim())
  const safeServer = {
    type: 'stdio',
    command: config.mcpServers.axiom.command,
    args: config.mcpServers.axiom.args,
    envKeys: ['AXIOM_E2E_SYNTHETIC']
  }
  expect(launch.mcpServers).toEqual({ axiom: safeServer })
  const safeConfig = JSON.stringify({ mcpServers: { axiom: safeServer } })
  expect(launch.argv).toEqual(
    form === 'joined' ? [`--mcp-config=${safeConfig}`] : ['--mcp-config', safeConfig]
  )
})

it.skipIf(!source).each([false, true])(
  'uses the real SDK and MCP server (no proposal: %s)',
  async (noProposal) => {
    if (!source) {
      throw new Error('AXIOM_FIXTURE_REPO not set')
    }
    const directory = mkdtempSync(path.join(os.tmpdir(), 'axiom-planner-sdk-'))
    scratch.push(directory)
    const executable = createAxiomClaudePlannerStub(directory)
    const worktree = path.join(directory, 'worktree')
    mkdirSync(path.join(worktree, 'scenarios', 'goal'), { recursive: true })
    const frozen = spawnSync(
      'git',
      [
        '-C',
        source,
        'show',
        'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642:scenarios/goal/decomposition.json'
      ],
      { encoding: 'utf8' }
    )
    expect(frozen.status, frozen.stderr).toBe(0)
    writeFileSync(path.join(worktree, 'scenarios', 'goal', 'decomposition.json'), frozen.stdout)
    const settingsPath = path.join(directory, 'planner-settings.json')
    const settings = {
      permissions: {
        allow: ['Read', 'mcp__axiom__plan_propose'],
        deny: ['Edit', 'Write']
      }
    }
    writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 })
    const ledger = path.join(directory, 'ledger.jsonl')
    const capture = path.join(directory, 'proposal.json')
    const cli = path.join(directory, 'cli.cjs')
    const require = createRequire(import.meta.url)
    writeFileSync(
      cli,
      `
      const fs = require('node:fs');
      const { RuntimeClient } = require(${JSON.stringify(path.resolve('src/cli/runtime-client.ts'))});
      const { serveAttemptMcp } = require(${JSON.stringify(path.resolve('src/cli/handlers/axiom/attempt-mcp.ts'))});
      class FakeRuntime extends RuntimeClient {
        async call(method, params) {
          fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ method, proposal: params.planRevision }));
          return { id: 'rpc', ok: true, result: { planRevision: { id: 'plan-1', status: 'PROPOSED', tasks: params.planRevision.tasks, edges: params.planRevision.edges } }, _meta: { runtimeId: 'test' } };
        }
      }
      serveAttemptMcp({ client: new FakeRuntime('/unused', 500, null, null), cwd: process.cwd(), json: false,
        flags: new Map([['mission', 'mission-1'], ['attempt', 'attempt-1']]) }, { stdin: process.stdin, stdout: process.stdout, version: '1' });
    `
    )
    const mcpServers = {
      axiom: {
        type: 'stdio' as const,
        command: process.execPath,
        args: [
          '--require',
          require.resolve('tsx/cjs'),
          cli,
          'attempt',
          'mcp',
          '--mission',
          'mission-1',
          '--attempt',
          'attempt-1'
        ],
        env: { ORCA_AGENT_SESSION_ID: 'session-1', ORCA_STRUCTURED_SESSION: '1' }
      }
    }
    const canUseTool = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Unexpected prompt'
    }))
    const preamble =
      'Call plan_propose with { "proposal": <complete PlanProposal> }; "goalRevisionId": "goal-1"'
    const run = query({
      prompt: preamble,
      options: {
        pathToClaudeCodeExecutable: executable,
        cwd: worktree,
        settingSources: [],
        skills: [],
        managedSettings: AXIOM_TEST_CLAUDE_PLANNER_POLICY,
        settings: settingsPath,
        mcpServers,
        strictMcpConfig: true,
        permissionMode: 'default',
        effort: 'high',
        canUseTool,
        env: {
          ...process.env,
          ...AXIOM_TEST_CLAUDE_ENV,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
          AXIOM_E2E_LEDGER: ledger,
          AXIOM_E2E_PLANNER_NO_PROPOSAL: noProposal ? '1' : '0',
          ORCA_E2E_CLI_ENTRY: cli,
          CLAUDE_CONFIG_DIR: path.join(directory, 'account-home')
        }
      }
    })
    try {
      let result: unknown
      for await (const frame of run) {
        if (frame.type === 'result') {
          result = frame
          break
        }
      }
      expect(result).toMatchObject({ subtype: 'success', is_error: false, permission_denials: [] })
      expect(canUseTool).not.toHaveBeenCalled()
      const rows = readFileSync(ledger, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
      expect(rows.find((row) => row.kind === 'planner_launch')).toMatchObject({
        argv: expect.arrayContaining([
          '--settings',
          settingsPath,
          '--setting-sources=',
          '--managed-settings',
          JSON.stringify(AXIOM_TEST_CLAUDE_PLANNER_POLICY)
        ]),
        managedSettings: AXIOM_TEST_CLAUDE_PLANNER_POLICY,
        settingsPath,
        settings,
        initialize: { settingSources: null, skills: [] },
        strictMcpConfig: true,
        mcpServers: {
          axiom: {
            command: process.execPath,
            args: mcpServers.axiom.args,
            envKeys: ['ORCA_AGENT_SESSION_ID', 'ORCA_STRUCTURED_SESSION']
          }
        }
      })
      expect(rows.find((row) => row.kind === 'tools/list')?.tools).toContain('plan_propose')
      if (noProposal) {
        expect(rows.filter((row) => row.kind === 'proposal')).toEqual([])
        expect(existsSync(capture)).toBe(false)
        return
      }
      expect(rows.find((row) => row.kind === 'proposal')).toMatchObject({
        isError: false,
        response: { ok: true }
      })
      const submitted = JSON.parse(readFileSync(capture, 'utf8'))
      expect(submitted.method).toBe('axiom.plan.propose')
      expect(rows.find((row) => row.kind === 'tools/list')?.tools).toContain('plan_propose')
      const { provenance: _provenance, ...expected } = fixturePlanProposal(
        JSON.parse(frozen.stdout),
        'goal-1'
      )
      expect(submitted.proposal).toEqual(expected)
      expect(rows.filter((row) => row.kind === 'error')).toEqual([])
    } finally {
      run.close()
    }
  }
)
