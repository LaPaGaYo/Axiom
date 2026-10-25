import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterEach, expect, it } from 'vitest'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import {
  parseHeadlessWorkerEvents,
  parseHeadlessReport
} from '../../../src/main/axiom/execution/headless-worker-events'

const source = process.env.AXIOM_FIXTURE_REPO
let root: string | undefined
afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true })
  }
  root = undefined
})
it('emits syntactically valid provider JavaScript', () => {
  expect(() => new Function(AXIOM_TEST_PROVIDER_SOURCE)).not.toThrow()
})
it
  .skipIf(!source)
  .each([
    'retry',
    'deterministic-failure',
    'scope-violation',
    'secret-line',
    'transcript-secret',
    'test-skip',
    'assertion-drop',
    'suppression',
    'exit-nonzero',
    'bad-report',
    'agent-crash'
  ])(
  'runs the frozen fixture through exec: %s',
  (scenario) => {
    root = mkdtempSync(path.join(process.cwd(), '.axiom-work', 'tmp', 'headless-provider-'))
    const worktree = path.join(root, 'fixture')
    const git = (args: string[]) => {
      const result = spawnSync('git', args, { encoding: 'utf8' })
      expect(result.status, result.stderr).toBe(0)
    }
    git(['clone', '--quiet', '--no-hardlinks', source!, worktree])
    git([
      '-C',
      worktree,
      'checkout',
      '--quiet',
      '-b',
      'axiom/attempt/task-1/1',
      'a6a8413ecdcbbdb1d34f36950ba7e1aaa5a1a642'
    ])
    const provider = path.join(root, 'provider.cjs')
    const ledger = path.join(root, 'ledger.jsonl')
    const output = path.join(root, 'last-message.md')
    writeFileSync(provider, AXIOM_TEST_PROVIDER_SOURCE)
    writeFileSync(`${ledger}.scenario-task-1`, scenario)
    if (scenario === 'agent-crash') {
      writeFileSync(`${ledger}.crash-task-1`, '')
    }
    mkdirSync(path.join(worktree, '.axiom'), { recursive: true })
    const result = spawnSync(
      process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
      [
        provider,
        'exec',
        '--json',
        '--color',
        'never',
        '-s',
        'workspace-write',
        '-c',
        'sandbox_workspace_write.network_access=false',
        '-C',
        worktree,
        '-o',
        output,
        '-'
      ],
      {
        cwd: worktree,
        encoding: 'utf8',
        input: 'Mission: mission-1\nTask: task-1\nAttempt: attempt-1\n',
        env: {
          ...process.env,
          AXIOM_E2E_LEDGER: ledger,
          ORCA_E2E_CLI_ENTRY: 'unused-for-headless'
        },
        timeout: 60_000
      }
    )
    expect(result.status, result.stderr).toBe(
      scenario === 'exit-nonzero' ? 7 : scenario === 'agent-crash' ? 1 : 0
    )
    const events = parseHeadlessWorkerEvents(result.stdout)
    expect(events.providerSessionId).toBe('fixture-attempt-1')
    if (result.status === 0 && scenario !== 'bad-report') {
      const report = parseHeadlessReport(readFileSync(output, 'utf8'))
      expect(report.artifacts).toEqual([
        { path: '.axiom/artifacts/REPORT.md', kind: 'worker_report', mediaType: 'text/markdown' }
      ])
      expect(events.usage).toEqual({
        input_tokens: 100,
        cached_input_tokens: 40,
        output_tokens: 25
      })
      expect(readFileSync(path.join(worktree, report.artifacts[0].path), 'utf8')).toContain(
        'attemptId: attempt-1'
      )
    }
    expect(readFileSync(ledger, 'utf8')).toContain('"exec","--json"')
  },
  60_000
)
