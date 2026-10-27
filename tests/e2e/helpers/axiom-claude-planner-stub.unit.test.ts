import { query } from '@anthropic-ai/claude-agent-sdk'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createAxiomClaudePlannerStub } from './axiom-claude-planner-stub'
import { AXIOM_TEST_CLAUDE_ENV } from './axiom-test-claude-provider'
import { fixturePlanProposal } from './fixture-plan-proposal'

const source = process.env.AXIOM_FIXTURE_REPO
const scratch: string[] = []
afterEach(() => {
  for (const directory of scratch.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

it.skipIf(!source)(
  'accepts the real SDK handshake and executes the printed stdin recipe without prompting',
  async () => {
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
        allow: [
          'Read',
          'Bash(axiom plan propose --mission mission-1 --attempt attempt-1 --file:*)'
        ],
        deny: ['Edit', 'Write']
      }
    }
    writeFileSync(settingsPath, JSON.stringify(settings), { mode: 0o600 })
    const ledger = path.join(directory, 'ledger.jsonl')
    const capture = path.join(directory, 'proposal.json')
    const cli = path.join(directory, 'cli.cjs')
    writeFileSync(
      cli,
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(capture)}, JSON.stringify({ args: process.argv.slice(2), proposal: JSON.parse(fs.readFileSync(0, 'utf8')) })); process.stdout.write(JSON.stringify({ ok: true }));`
    )
    const canUseTool = vi.fn(async () => ({
      behavior: 'deny' as const,
      message: 'Unexpected prompt'
    }))
    const preamble = `axiom plan propose --mission mission-1 --attempt attempt-1 --file /dev/stdin --json <<'AXIOM_PLAN_JSON'
{"goalRevisionId":"goal-1"}
AXIOM_PLAN_JSON`
    const run = query({
      prompt: preamble,
      options: {
        pathToClaudeCodeExecutable: executable,
        cwd: worktree,
        settingSources: [],
        skills: ['review'],
        settings: settingsPath,
        permissionMode: 'default',
        effort: 'high',
        canUseTool,
        env: {
          ...process.env,
          ...AXIOM_TEST_CLAUDE_ENV,
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ''}`,
          AXIOM_E2E_LEDGER: ledger,
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
        argv: expect.arrayContaining(['--settings', settingsPath, '--setting-sources=']),
        settingsPath,
        settings,
        initialize: { settingSources: null, skills: ['review'] },
        env: { ...AXIOM_TEST_CLAUDE_ENV, CLAUDE_CONFIG_DIR: path.join(directory, 'account-home') }
      })
      expect(rows.find((row) => row.kind === 'proposal')).toMatchObject({
        attemptId: 'attempt-1',
        status: 0,
        response: { ok: true }
      })
      const submitted = JSON.parse(readFileSync(capture, 'utf8'))
      expect(submitted.args).toEqual([
        'plan',
        'propose',
        '--mission',
        'mission-1',
        '--attempt',
        'attempt-1',
        '--file',
        '/dev/stdin',
        '--json'
      ])
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
