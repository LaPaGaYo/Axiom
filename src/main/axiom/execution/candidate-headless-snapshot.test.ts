import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { snapshotCandidate } from './candidate-snapshot'

let root: string
afterEach(async () => {
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})
it('snapshots a linked worktree despite a stale index lock, excluding even staged .axiom files', async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-headless-git-'))
  const git = async (args: string[], cwd = root) =>
    (await gitExecFileAsync(args, { cwd })).stdout.trim()
  await git(['init'])
  await writeFile(path.join(root, 'code.txt'), 'baseline')
  await git(['add', '.'])
  await git([
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--no-gpg-sign',
    '-m',
    'base'
  ])
  const branch = 'axiom/attempt/task/1'
  const worktree = path.join(root, 'worker')
  await git(['worktree', 'add', '-b', branch, worktree])
  await mkdir(path.join(worktree, '.axiom', 'artifacts'), { recursive: true })
  await writeFile(path.join(worktree, '.axiom', 'prompt.md'), 'private prompt')
  await git(['add', '.axiom'], worktree)
  await writeFile(path.join(worktree, 'code.txt'), 'changed')
  const gitDir = await git(['rev-parse', '--absolute-git-dir'], worktree)
  await writeFile(path.join(gitDir, 'index.lock'), 'do not remove this lock')
  await writeFile(
    path.join(root, '.git', 'hooks', 'reference-transaction'),
    '#!/bin/sh\nexit 88\n',
    { mode: 0o755 }
  )
  const snapshot = await snapshotCandidate({
    attemptId: 'd1',
    worktreeId: `repo::${worktree}`,
    branch,
    headless: true
  })
  expect(await git(['ls-tree', '-r', '--name-only', snapshot.commitSha], worktree)).toBe('code.txt')
  expect(await git(['show', `${snapshot.commitSha}:code.txt`], worktree)).toBe('changed')
  expect(await readFile(path.join(gitDir, 'index.lock'), 'utf8')).toBe('do not remove this lock')
  expect(
    (
      await snapshotCandidate({
        attemptId: 'd1',
        worktreeId: `repo::${worktree}`,
        branch,
        headless: true
      })
    ).commitSha
  ).toBe(snapshot.commitSha)
})
