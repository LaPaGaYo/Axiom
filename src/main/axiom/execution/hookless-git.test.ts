import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { confinedGitEnv, withHooklessGit } from './hookless-git'

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    await rm(root, { recursive: true, force: true })
  }
})

async function repository() {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-hookless-test-'))
  roots.push(root)
  const cwd = path.join(root, 'outer')
  await mkdir(cwd)
  const git = async (...args: string[]) =>
    (await gitExecFileAsync(args, { cwd, timeout: 30_000 })).stdout.trim()
  await git('init', '-q')
  await git('config', 'user.name', 'Hookless test')
  await git('config', 'user.email', 'hookless@localhost')
  await git('config', 'commit.gpgsign', 'false')
  await git('config', 'core.hooksPath', '')
  await git('commit', '--allow-empty', '-qm', 'base')
  const base = await git('rev-parse', 'HEAD')
  return { root, cwd, git, base }
}

it('runs no repository hook and removes its directory', async () => {
  const f = await repository()
  const hookDirectory = path.join(f.root, 'hooks')
  const marker = path.join(f.root, 'hook-ran')
  await mkdir(hookDirectory)
  for (const name of ['reference-transaction', 'post-commit']) {
    await writeFile(
      path.join(hookDirectory, name),
      '#!/bin/sh\nprintf "hook\\n" >> "${0%/*}/../hook-ran"\n',
      { mode: 0o755 }
    )
  }
  await f.git('config', 'core.hooksPath', hookDirectory)
  const ref = 'refs/axiom/hookless'
  const result = { written: true }
  let directory = ''
  let calls = 0
  expect(
    await withHooklessGit(
      f.cwd,
      { timeout: undefined, confine: false },
      async ({ hooks, options, directory: current }) => {
        calls += 1
        directory = current
        roots.push(directory)
        expect((await stat(directory)).isDirectory()).toBe(true)
        expect(await readdir(directory)).toEqual([])
        await gitExecFileAsync([...hooks, 'update-ref', ref, f.base], options)
        await gitExecFileAsync([...hooks, 'commit', '--allow-empty', '-qm', 'hookless'], options)
        expect(await readdir(directory)).toEqual([])
        return result
      }
    )
  ).toBe(result)
  expect(calls).toBe(1)
  expect(await f.git('rev-parse', ref)).toBe(f.base)
  expect(await f.git('rev-parse', 'HEAD')).not.toBe(f.base)
  expect(await f.git('log', '-1', '--format=%s')).toBe('hookless')
  await expect(stat(marker)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
  await f.git('update-ref', 'refs/axiom/control', f.base)
  expect(await readFile(marker, 'utf8')).not.toBe('')
})

it('removes its directory when the write fails', async () => {
  const f = await repository()
  let directory = ''
  let gitError: unknown
  const write = withHooklessGit(
    f.cwd,
    { timeout: undefined, confine: false },
    async ({ hooks, options, directory: current }) => {
      directory = current
      roots.push(directory)
      try {
        await gitExecFileAsync(
          [...hooks, 'update-ref', 'refs/axiom/failure', 'invalid-oid'],
          options
        )
      } catch (error) {
        gitError = error
        throw error
      }
    }
  )
  const caught = await write.catch((error: unknown) => error)
  expect(gitError).toBeInstanceOf(Error)
  expect(caught).toBe(gitError)
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })

  const ownError = new Error('callback failed')
  await expect(
    withHooklessGit(
      f.cwd,
      { timeout: undefined, confine: false },
      async ({ directory: current }) => {
        directory = current
        roots.push(directory)
        await writeFile(path.join(directory, 'index'), 'private index')
        throw ownError
      }
    )
  ).rejects.toBe(ownError)
  await expect(stat(directory)).rejects.toMatchObject({ code: 'ENOENT' })
})

it('confines git to the given directory only when asked', async () => {
  const f = await repository()
  const inner = path.join(f.cwd, 'inner')
  await mkdir(inner)
  const top = (cwd: string, confine: boolean) =>
    withHooklessGit(cwd, { timeout: undefined, confine }, async ({ options, directory }) => {
      roots.push(directory)
      return (await gitExecFileAsync(['rev-parse', '--show-toplevel'], options)).stdout.trim()
    })
  await expect(top(inner, true)).rejects.toBeInstanceOf(Error)
  expect(await realpath(await top(inner, false))).toBe(await realpath(f.cwd))
  expect(await realpath(await top(f.cwd, true))).toBe(await realpath(f.cwd))
  await expect(
    gitExecFileAsync(['rev-parse', '--show-toplevel'], {
      ...gitOptionsForWorktree(inner),
      env: confinedGitEnv(inner)
    })
  ).rejects.toBeInstanceOf(Error)
})

it('passes the deadline and the environment only when they are given', async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), 'axiom-hookless-options-'))
  roots.push(cwd)
  const custom = { PATH: '/custom/path', STRUCT_SCOPE: 'custom' }
  const originalCustom = { ...custom }
  const originalEnvironment = { ...process.env }
  const inspect = (settings: Parameters<typeof withHooklessGit>[1]) =>
    withHooklessGit(cwd, settings, async ({ hooks, options, directory }) => {
      roots.push(directory)
      expect(hooks).toEqual(['-c', `core.hooksPath=${directory}`])
      return options
    })
  const plain = await inspect({ timeout: undefined, confine: false })
  expect(plain).toEqual(gitOptionsForWorktree(cwd))
  expect('timeout' in plain).toBe(false)
  expect('env' in plain).toBe(false)
  expect(await inspect({ timeout: 30_000, confine: false })).toEqual({ cwd, timeout: 30_000 })

  const confined = await inspect({ timeout: undefined, confine: true })
  expect(confined).toEqual({
    cwd,
    env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) }
  })
  expect('timeout' in confined).toBe(false)
  expect(await inspect({ timeout: 120_000, confine: true, env: custom })).toEqual({
    cwd,
    timeout: 120_000,
    env: { ...custom, GIT_CEILING_DIRECTORIES: path.dirname(cwd) }
  })
  const unconfined = await inspect({ timeout: undefined, confine: false, env: custom })
  expect(unconfined).toEqual({ cwd, env: custom })
  expect(unconfined.env).toBe(custom)
  expect('timeout' in unconfined).toBe(false)
  expect(custom).toEqual(originalCustom)
  expect(process.env).toEqual(originalEnvironment)
})
