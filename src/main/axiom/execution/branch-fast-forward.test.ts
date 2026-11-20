import { afterEach, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import * as branches from './integration-base'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function repository() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-deliver-')))
  roots.push(root)
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  const git = async (...args: string[]) =>
    (await gitExecFileAsync(args, { cwd: repo, timeout: 30_000 })).stdout.trim()
  await git('init', '-q')
  await git('config', 'user.name', 'Delivery test')
  await git('config', 'user.email', 'delivery@localhost')
  await git('config', 'core.hooksPath', '')
  await git('config', 'core.logAllRefUpdates', 'true')
  await writeFile(path.join(repo, 'file'), 'base')
  await git('add', 'file')
  await git('commit', '--no-gpg-sign', '-qm', 'base')
  const from = await git('rev-parse', 'HEAD')
  await git('branch', 'target')
  await writeFile(path.join(repo, 'file'), 'child')
  await git('commit', '--no-gpg-sign', '-qam', 'child')
  const to = await git('rev-parse', 'HEAD')
  const ref = 'refs/heads/target'
  const input = { repoPath: repo, ref, from, to, hooks: 'on' as const }
  expect(branches).toHaveProperty('advanceLocalBranch')
  return { root, repo, git, from, to, ref, input }
}

it('a local branch is fast forwarded from the expected commit with a reflog message', async () => {
  const f = await repository()
  const reflogMessage = 'axiom: deliver test-mission'
  expect(await branches.advanceLocalBranch({ ...f.input, reflogMessage })).toEqual({
    advanced: true,
    written: true
  })
  expect(await f.git('rev-parse', f.ref)).toBe(f.to)
  expect(await f.git('reflog', 'show', '-1', '--format=%gs', f.ref)).toBe(reflogMessage)
})

it('a branch that is checked out in a worktree is not moved and the worktree is named', async () => {
  const f = await repository()
  const linked = path.join(f.root, 'linked')
  await f.git('worktree', 'add', linked, 'target')
  expect(await branches.advanceLocalBranch(f.input)).toEqual({
    advanced: false,
    reason: 'checked_out',
    worktreePath: linked
  })
  expect(await f.git('rev-parse', f.ref)).toBe(f.from)
  expect(await readFile(path.join(linked, 'file'), 'utf8')).toBe('base')
})

it('a branch that moved or is missing or is a symbolic ref is not written', async () => {
  const f = await repository()
  expect(await branches.advanceLocalBranch({ ...f.input, from: f.to, to: f.to })).toEqual({
    advanced: false,
    reason: 'moved'
  })
  for (const ref of ['refs/heads/missing', 'refs/tags/target', 'HEAD']) {
    expect(await branches.advanceLocalBranch({ ...f.input, ref })).toEqual({
      advanced: false,
      reason: 'unavailable'
    })
  }
  await f.git('branch', 'other', f.from)
  await f.git('symbolic-ref', f.ref, 'refs/heads/other')
  expect(await branches.advanceLocalBranch(f.input)).toEqual({
    advanced: false,
    reason: 'unavailable'
  })
  expect(await f.git('rev-parse', 'refs/heads/other')).toBe(f.from)
})

it('a branch already at the new commit is reported as not written by this call', async () => {
  const f = await repository()
  const before = await f.git('reflog', 'show', '--format=%H', f.ref)
  expect(await branches.advanceLocalBranch({ ...f.input, to: f.from })).toEqual({
    advanced: true,
    written: false
  })
  expect(await f.git('reflog', 'show', '--format=%H', f.ref)).toBe(before)
})

it('the hooks of the repository run when the caller keeps them on and can refuse the move', async () => {
  const f = await repository()
  const hooks = path.join(f.root, 'hooks')
  const mark = path.join(f.root, 'hook-ran')
  await mkdir(hooks)
  await writeFile(
    path.join(hooks, 'reference-transaction'),
    `#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in ${f.ref}) echo ran >> '${mark}'; exit 1;; esac\ndone\n`,
    { mode: 0o755 }
  )
  await f.git('config', 'core.hooksPath', hooks)
  expect(await branches.advanceLocalBranch(f.input)).toEqual({
    advanced: false,
    reason: 'unavailable'
  })
  expect(await f.git('rev-parse', f.ref)).toBe(f.from)
  const ran = await readFile(mark, 'utf8')
  expect(ran).toContain('ran')
  expect(await branches.advanceLocalBranch({ ...f.input, hooks: 'off' })).toEqual({
    advanced: true,
    written: true
  })
  expect(await readFile(mark, 'utf8')).toBe(ran)
  expect(await f.git('rev-parse', f.ref)).toBe(f.to)
})
