import { mkdtemp, mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAppEnvironment } from '../../../shared/app-environment'
import * as git from '../../git/runner'
import { prepareHeadlessAttemptFiles } from './headless-attempt-files'

let root: string
let worktree: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-headless-files-'))
  worktree = path.join(root, 'worktree')
  await mkdir(worktree)
  vi.spyOn(getAppEnvironment(), 'getPath').mockReturnValue(path.join(root, 'userData'))
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: `${'a'.repeat(40)}\n`, stderr: '' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const input = () => ({
  attemptId: 'd1',
  worktree,
  worktreeId: `repo::${worktree}`,
  branch: 'axiom/attempt/t1/1',
  prompt: 'Attempt: d1\nTask recovery instructions'
})

it('writes the same recovery prompt in host custody and the worktree, retaining the immutable baseline', async () => {
  const directory = await prepareHeadlessAttemptFiles(input())
  expect(directory).toBe(path.join(root, 'userData', 'axiom', 'attempts', 'd1'))
  expect(await readFile(path.join(directory, 'prompt.md'), 'utf8')).toBe(input().prompt)
  expect(await readFile(path.join(worktree, '.axiom', 'prompt.md'), 'utf8')).toBe(input().prompt)
  expect(JSON.parse(await readFile(path.join(directory, 'launch.json'), 'utf8'))).toEqual({
    baselineSha: 'a'.repeat(40),
    worktreeId: `repo::${worktree}`,
    branch: input().branch
  })
})
it('refuses a repository-provided symlink for the recovery directory', async () => {
  await symlink(root, path.join(worktree, '.axiom'))
  await expect(prepareHeadlessAttemptFiles(input())).rejects.toThrow(/Unsafe/)
  expect(git.gitExecFileAsync).not.toHaveBeenCalled()
})
