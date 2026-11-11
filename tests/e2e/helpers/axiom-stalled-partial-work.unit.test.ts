import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import { mission } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import { OrchestrationDb } from '../../../src/main/runtime/orchestration/db/orchestration-db'
import { buildHeadlessTerminalCommand } from '../../../src/main/runtime/rpc/methods/orchestration/worker/control-plane-worker-start'
import { AxiomStore } from '../../../src/main/axiom/db/axiom-store'
import { ArtifactStore } from '../../../src/main/axiom/artifacts/artifact-store'
import { collectAttemptPreservation } from '../../../src/main/axiom/execution/attempt-preservation'
import { HandoffRecordsSchema } from '../../../src/main/axiom/execution/headless-handoff-records'
import { preservedRepository } from '../../../src/main/axiom/execution/preserved-snapshot.test-support'

const partial = 'src/services/budget-partial.ts'
let repo: Awaited<ReturnType<typeof preservedRepository>>
let host: string
let ledger: string
let db: OrchestrationDb
let artifacts: ArtifactStore
const processes: { child: ChildProcess; closed: Promise<void> }[] = []

beforeEach(async () => {
  repo = await preservedRepository()
  host = await mkdtemp(path.join(tmpdir(), 'axiom-stalled-stub-'))
  ledger = path.join(host, 'ledger')
  db = new OrchestrationDb(':memory:')
  const store = new AxiomStore(db)
  store.insertMission({ ...mission, id: repo.input.missionId, repoPath: repo.root })
  artifacts = new ArtifactStore(store, path.join(host, 'artifacts'))
  await writeFile(path.join(host, 'provider.cjs'), AXIOM_TEST_PROVIDER_SOURCE)
  await writeFile(`${ledger}.hold`, '')
  await writeFile(`${ledger}.stall-t`, '')
  await writeFile(`${ledger}.partial-t`, partial)
  await writeFile(`${ledger}.scenario-t`, 'bad-report')
})

async function stop(entry: (typeof processes)[number]) {
  if (entry.child.pid && entry.child.exitCode === null && entry.child.signalCode === null) {
    process.kill(-entry.child.pid, 'SIGKILL')
  }
  await entry.closed
}

afterEach(async () => {
  for (const entry of processes.splice(0)) {
    await stop(entry)
  }
  db.close()
  await rm(repo.root, { recursive: true, force: true })
  await rm(host, { recursive: true, force: true })
})

async function launch(attemptId: string) {
  const directory = path.join(host, attemptId)
  await mkdir(directory)
  const stdinPath = path.join(directory, 'prompt.md')
  await writeFile(stdinPath, `Mission: m\nTask: t\nAttempt: ${attemptId}\n`)
  const { command } = buildHeadlessTerminalCommand({
    argv: [
      process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
      path.join(host, 'provider.cjs'),
      'exec',
      '--json',
      '-s',
      'workspace-write',
      '-C',
      repo.root,
      '-o',
      path.join(directory, 'last-message.md'),
      '-'
    ],
    env: { ORCA_BACKGROUND_LAUNCH: '1', AXIOM_E2E_LEDGER: ledger, ORCA_E2E_CLI_ENTRY: 'unused' },
    stdinPath,
    attemptDir: directory
  })
  const child = spawn('/bin/bash', ['-c', command], {
    cwd: repo.root,
    env: { ...process.env, ORCA_BACKGROUND_LAUNCH: '1' },
    detached: true,
    stdio: 'ignore'
  })
  const entry = {
    child,
    closed: new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('close', () => resolve())
    })
  }
  processes.push(entry)
  return { ...entry, directory }
}

async function readEvents(directory: string) {
  return readFile(path.join(directory, 'events.jsonl'), 'utf8').catch(() => '')
}

async function stoppedPartial(cutLastLine: boolean) {
  const first = await launch('d1')
  await expect
    .poll(() => readEvents(first.directory), { timeout: 10_000 })
    .toContain('turn.started')
  expect(existsSync(`${ledger}.stall-t`)).toBe(true)
  expect(existsSync(path.join(repo.root, partial))).toBe(false)
  await rm(`${ledger}.hold`)
  await expect
    .poll(() => readEvents(first.directory), { timeout: 10_000 })
    .toContain('"status":"completed"')
  expect(existsSync(`${ledger}.stall-t`)).toBe(false)
  expect(first.child.exitCode).toBeNull()
  expect(first.child.signalCode).toBeNull()
  await stop(first)
  expect(first.child.signalCode).toBe('SIGKILL')
  expect(existsSync(path.join(first.directory, 'exit-code'))).toBe(false)
  const events = await readEvents(first.directory)
  expect(events).not.toContain('turn.completed')
  expect(events).not.toContain('turn.failed')
  const lastLine = events.lastIndexOf('\n', events.length - 2) + 1
  const capture = await collectAttemptPreservation(artifacts, {
    ...repo.input,
    allowedPaths: [partial],
    provider: 'codex',
    eventsText: cutLastLine ? events.slice(0, lastLine + 32) : events
  })
  expect(capture.result).toMatchObject({ status: 'preserved', scopePaths: [partial], secrets: [] })
  if (capture.result.status !== 'preserved' || !capture.artifactId) {
    throw new Error('Missing preserved snapshot or handoff Artifact')
  }
  const { snapshot } = capture.result
  expect(await repo.git(['rev-parse', snapshot.ref])).toBe(snapshot.commitSha)
  expect(await repo.git(['show', `${snapshot.commitSha}:${partial}`])).toBe(
    (await readFile(path.join(repo.root, partial), 'utf8')).trim()
  )
  expect(await repo.git(['rev-parse', repo.branch])).toBe(repo.baselineSha)
  const stored = await artifacts.read(capture.artifactId)
  const records = HandoffRecordsSchema.parse(JSON.parse(stored.content.toString('utf8')))
  expect(records.messages).toEqual(['I left partial work for the next Attempt to review.'])
  expect(records.changes).toEqual([{ path: partial, status: 'added', added: 2, removed: 0 }])
  return records
}

it.skipIf(process.platform === 'win32')(
  'stalls once after the hold and preserves partial work when the process group is stopped',
  async () => {
    const records = await stoppedPartial(false)
    expect(records.commands).toEqual([
      {
        command: `git status --short -- "${partial}"`,
        output: `?? ${partial}\n`,
        exitCode: 0,
        unfinished: false
      }
    ])
    const successor = await launch('d2')
    await expect
      .poll(
        () => readFile(path.join(successor.directory, 'exit-code'), 'utf8').catch(() => undefined),
        { timeout: 10_000 }
      )
      .toBe('0\n')
    expect(await readEvents(successor.directory)).toContain('turn.completed')
    expect(await readEvents(successor.directory)).not.toContain('partial-command')
  }
)

it.skipIf(process.platform === 'win32')(
  'keeps earlier records when the event stream ends mid-line',
  async () => {
    const records = await stoppedPartial(true)
    expect(records.commands).toEqual([
      { command: `git status --short -- "${partial}"`, output: '', unfinished: true }
    ])
  }
)
