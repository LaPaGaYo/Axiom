import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { advanceIntegrationHead } from './integration-base'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function repository() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-advance-')))
  roots.push(root)
  const repo = path.join(root, 'repo')
  await mkdir(repo)
  const git = async (...args: string[]) =>
    (await gitExecFileAsync(args, { cwd: repo, timeout: 30_000 })).stdout.trim()
  await git('init', '-q')
  await git('config', 'user.name', 'Promotion test')
  await git('config', 'user.email', 'promotion@localhost')
  await git('config', 'core.hooksPath', '')
  await git('config', 'core.logAllRefUpdates', 'true')
  await writeFile(path.join(repo, 'file'), 'base')
  await git('add', 'file')
  await git('commit', '--no-gpg-sign', '-qm', 'base')
  const base = await git('rev-parse', 'HEAD')
  const missionId = 'promotion-test'
  const ref = `refs/heads/axiom/integration/${missionId}`
  await git('branch', `axiom/integration/${missionId}`)
  await writeFile(path.join(repo, 'file'), 'child')
  await git('commit', '--no-gpg-sign', '-qam', 'child')
  const child = await git('rev-parse', 'HEAD')
  const linked = path.join(root, 'linked')
  await git('worktree', 'add', '--detach', linked, base)
  const input = { repoPath: repo, missionId, from: base, to: child }
  return { root, repo, git, base, child, ref, linked, input }
}

async function rejectingHook(f: Awaited<ReturnType<typeof repository>>) {
  const hooks = path.join(f.root, 'hooks')
  const mark = path.join(f.root, 'hook-ran')
  await mkdir(hooks)
  await writeFile(
    path.join(hooks, 'reference-transaction'),
    `#!/bin/sh\nwhile read old new ref; do\ncase "$ref" in ${f.ref}) echo ran >> '${mark}'; exit 1;; esac\ndone\n`,
    { mode: 0o755 }
  )
  await f.git('config', 'core.hooksPath', hooks)
  return mark
}

it('advances the integration head only from the expected commit and never under a checkout', async () => {
  const f = await repository()
  const mark = await rejectingHook(f)
  expect(await advanceIntegrationHead(f.input)).toEqual({ advanced: true })
  expect(await f.git('rev-parse', f.ref)).toBe(f.child)
  await expect(readFile(mark)).rejects.toMatchObject({ code: 'ENOENT' })
  const reflog = await f.git('reflog', 'show', '--format=%H', f.ref)
  expect(await advanceIntegrationHead(f.input)).toEqual({ advanced: true })
  expect(await f.git('reflog', 'show', '--format=%H', f.ref)).toBe(reflog)
  expect(await advanceIntegrationHead({ ...f.input, to: f.base })).toEqual({
    advanced: false,
    reason: 'moved'
  })
  expect(await f.git('rev-parse', f.ref)).toBe(f.child)
  await gitExecFileAsync(['checkout', `axiom/integration/${f.input.missionId}`], { cwd: f.linked })
  expect(await advanceIntegrationHead({ ...f.input, from: f.child, to: f.base })).toEqual({
    advanced: false,
    reason: 'checked_out'
  })
  expect(await f.git('rev-parse', f.ref)).toBe(f.child)
  expect(await readFile(path.join(f.linked, 'file'), 'utf8')).toBe('child')
  await f.git('worktree', 'remove', f.linked)

  const main = await repository()
  await main.git('checkout', `axiom/integration/${main.input.missionId}`)
  await rejectingHook(main)
  expect(await advanceIntegrationHead(main.input)).toEqual({
    advanced: false,
    reason: 'checked_out'
  })
  expect(await main.git('rev-parse', main.ref)).toBe(main.base)
  expect(await readFile(path.join(main.repo, 'file'), 'utf8')).toBe('base')

  for (const input of [
    { ...f.input, missionId: 'missing' },
    { ...f.input, repoPath: path.join(f.root, 'missing') },
    { ...f.input, from: 'bad-id' },
    { ...f.input, to: 'bad-id' },
    { ...f.input, from: f.child, to: 'f'.repeat(40) }
  ]) {
    expect(await advanceIntegrationHead(input)).toEqual({ advanced: false, reason: 'unavailable' })
  }
  expect(await f.git('rev-parse', f.ref)).toBe(f.child)
  await f.git('branch', 'other', f.child)
  await f.git('-c', 'core.hooksPath=', 'symbolic-ref', f.ref, 'refs/heads/other')
  expect(await advanceIntegrationHead({ ...f.input, from: f.child, to: f.base })).toEqual({
    advanced: false,
    reason: 'unavailable'
  })
  expect(await f.git('rev-parse', 'refs/heads/other')).toBe(f.child)
  await expect(readFile(mark)).rejects.toMatchObject({ code: 'ENOENT' })
})
