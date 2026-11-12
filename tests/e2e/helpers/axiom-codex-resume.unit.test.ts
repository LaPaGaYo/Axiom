import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { z } from 'zod'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'

let root: string
let ledger: string
let provider: string
let home: string
let worktree: string
let output: string
const threadId = 'fixture-original-attempt'
const taskId = 'task-1'
const attemptId = 'attempt-2'

beforeEach(() => {
  root = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'axiom-codex-resume-')))
  ledger = path.join(root, 'ledger.jsonl')
  provider = path.join(root, 'provider.cjs')
  home = path.join(root, 'codex-home')
  worktree = path.join(root, 'worktree')
  output = path.join(root, 'last-message.md')
  mkdirSync(worktree)
  writeFileSync(provider, AXIOM_TEST_PROVIDER_SOURCE)
  writeFileSync(`${ledger}.scenario-${taskId}`, 'bad-report')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function run(args: string[]) {
  return spawnSync(process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath, [provider, ...args], {
    cwd: worktree,
    encoding: 'utf8',
    input: `Mission: mission-1\nTask: ${taskId}\nAttempt: ${attemptId}\n`,
    env: {
      ...process.env,
      AXIOM_E2E_LEDGER: ledger,
      CODEX_HOME: home,
      ORCA_E2E_CLI_ENTRY: 'unused-for-headless'
    },
    timeout: 30_000
  })
}
function resume() {
  return run([
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
    'resume',
    threadId,
    '-'
  ])
}
function record(extension = 'jsonl', base = home) {
  const directory = path.join(base, 'sessions', '2026', '11', '03')
  mkdirSync(directory, { recursive: true })
  const filename = path.join(directory, `rollout-2026-11-03T12-00-00-${threadId}.${extension}`)
  writeFileSync(filename, 'The stub checks only the filename.\n')
  return filename
}
function assertRefusal(result: ReturnType<typeof resume>, marker: string) {
  expect(result.status, result.stderr).toBe(1)
  expect(result.stdout).toBe('')
  expect(result.stderr).toBe(
    `Error: thread/resume: thread/resume failed: no rollout found for thread id ${threadId} (code -32600)\n`
  )
  expect(existsSync(output)).toBe(false)
  const entries = readFileSync(ledger, 'utf8')
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(entries).toContainEqual(
    expect.objectContaining({
      kind: 'resume_refused',
      attemptId,
      taskId,
      threadId,
      marker
    })
  )
}

it('keeps the default Codex version when no version marker exists', () => {
  const result = run(['--version'])
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('codex-cli 0.0.0-e2e\n')
  expect(result.stderr).toBe('')
  expect(existsSync(ledger)).toBe(false)
})
it('reports the trimmed Codex version marker before any worker work', () => {
  writeFileSync(`${ledger}.version`, '  codex-cli 0.163.0\n\n')
  const result = run(['--version'])
  expect(result.status, result.stderr).toBe(0)
  expect(result.stdout).toBe('codex-cli 0.163.0\n')
  expect(result.stderr).toBe('')
  expect(existsSync(ledger)).toBe(false)
})
it.each(['jsonl', 'jsonl.zst'])('resumes the requested recorded thread from %s', (extension) => {
  record(extension)
  const result = resume()
  expect(result.status, result.stderr).toBe(0)
  expect(result.stderr).toBe('')
  expect(JSON.parse(result.stdout.split('\n')[0])).toEqual({
    type: 'thread.started',
    thread_id: threadId
  })
  expect(readFileSync(output, 'utf8')).toBe('Invalid final report')
  const first = z
    .object({ argv: z.array(z.string()), cwd: z.string() })
    .parse(JSON.parse(readFileSync(ledger, 'utf8').split('\n')[0]))
  expect(first.argv.slice(-3)).toEqual(['resume', threadId, '-'])
  expect(first.cwd).toBe(worktree)
})
it('refuses a resume with no rollout in the selected Codex home', () => {
  record('jsonl', path.join(root, 'another-account'))
  assertRefusal(resume(), 'session_record_missing')
  expect(existsSync(home)).toBe(false)
})
it('consumes a refusal marker once even when the session record exists', () => {
  const rollout = record()
  const marker = `${ledger}.refuse-resume-${taskId}`
  writeFileSync(marker, '')
  assertRefusal(resume(), 'refuse-resume')
  expect(existsSync(marker)).toBe(false)
  expect(readFileSync(rollout, 'utf8')).toBe('The stub checks only the filename.\n')
  const accepted = resume()
  expect(accepted.status, accepted.stderr).toBe(0)
  expect(JSON.parse(accepted.stdout.split('\n')[0])).toEqual({
    type: 'thread.started',
    thread_id: threadId
  })
})
