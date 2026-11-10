import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { z } from 'zod'
import { AXIOM_TEST_PROVIDER_SOURCE } from './axiom-test-provider'
import { preserveAttemptWorktree } from '../../../src/main/axiom/execution/preserved-snapshot'
import { readHeadlessHandoffRecords } from '../../../src/main/axiom/execution/headless-handoff-records'
import { preservedRepository } from '../../../src/main/axiom/execution/preserved-snapshot.test-support'

let f: Awaited<ReturnType<typeof preservedRepository>>
let host: string
beforeEach(async () => {
  f = await preservedRepository()
  host = await mkdtemp(path.join(tmpdir(), 'axiom-partial-stub-'))
})
afterEach(async () => {
  await rm(f.root, { recursive: true, force: true })
  await rm(host, { recursive: true, force: true })
})
it('captures partial work and real protocol records emitted before the Codex interruption', async () => {
  const ledger = path.join(host, 'ledger')
  const provider = path.join(host, 'provider.cjs')
  const partial = 'src/services/partial.ts'
  await writeFile(provider, AXIOM_TEST_PROVIDER_SOURCE)
  await writeFile(`${ledger}.interrupt-t`, '1')
  await writeFile(`${ledger}.partial-t`, partial)
  const processResult = spawnSync(
    process.env.ORCA_TEST_NODE_EXECUTABLE ?? process.execPath,
    [
      provider,
      'exec',
      '--json',
      '-s',
      'workspace-write',
      '-C',
      f.root,
      '-o',
      path.join(host, 'report.md'),
      '-'
    ],
    {
      encoding: 'utf8',
      timeout: 30_000,
      input: 'Mission: m\nTask: t\nAttempt: d1\n',
      env: {
        ...process.env,
        ORCA_BACKGROUND_LAUNCH: '1',
        AXIOM_E2E_LEDGER: ledger,
        ORCA_E2E_CLI_ENTRY: 'unused'
      }
    }
  )
  expect(processResult.status, processResult.stderr).toBe(75)
  const events = processResult.stdout
    .trim()
    .split('\n')
    .map((line) => z.object({ type: z.string() }).parse(JSON.parse(line)))
  expect(events.map(({ type }) => type)).toEqual([
    'thread.started',
    'turn.started',
    'item.completed',
    'item.started',
    'item.completed',
    'turn.failed'
  ])
  const records = readHeadlessHandoffRecords(processResult.stdout, 'codex')
  expect(records.messages).toEqual(['I left partial work for the next Attempt to review.'])
  expect(records.commands).toEqual([
    {
      command: `git status --short -- "${partial}"`,
      exitCode: 0,
      unfinished: false,
      output: `?? ${partial}\n`
    }
  ])
  const snapshot = await preserveAttemptWorktree({ ...f.input, allowedPaths: [partial] })
  expect(snapshot).toMatchObject({
    status: 'preserved',
    scopePaths: [partial],
    secrets: [],
    changes: [{ path: partial, added: 2, removed: 0 }]
  })
  if (snapshot.status !== 'preserved') {
    throw new Error('snapshot missing')
  }
  expect(await f.git(['show', `${snapshot.snapshot.commitSha}:${partial}`])).toBe(
    (await readFile(path.join(f.root, partial), 'utf8')).trim()
  )
  expect(await f.git(['rev-parse', f.branch])).toBe(f.baselineSha)
})
