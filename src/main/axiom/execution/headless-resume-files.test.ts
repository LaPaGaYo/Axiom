import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAppEnvironment } from '../../../shared/app-environment'
import * as git from '../../git/runner'
import { prepareHeadlessAttemptFiles } from './headless-attempt-files'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-resume-prompts-'))
  await mkdir(path.join(root, 'worktree'))
  vi.spyOn(getAppEnvironment(), 'getPath').mockReturnValue(path.join(root, 'userData'))
  vi.spyOn(git, 'gitExecFileAsync').mockResolvedValue({ stdout: 'a'.repeat(40), stderr: '' })
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})
const input = () => ({
  attemptId: 'd2',
  worktree: path.join(root, 'worktree'),
  worktreeId: 'repo::worktree',
  branch: 'axiom/attempt/t/2',
  prompt: 'Attempt: d2\n## Task spec\nfull'
})
it('delivers the continuation prompt and keeps the full contract in the worktree', async () => {
  const short = 'Mission: m\nTask: t\nAttempt: d2\nContinue the same conversation.'
  const directory = await prepareHeadlessAttemptFiles({ ...input(), stdinPrompt: short })
  expect(await readFile(path.join(directory, 'prompt.md'), 'utf8')).toBe(short)
  expect(await readFile(path.join(input().worktree, '.axiom/prompt.md'), 'utf8')).toBe(
    input().prompt
  )
  expect(JSON.parse(await readFile(path.join(directory, 'launch.json'), 'utf8'))).toEqual({
    worktreeId: input().worktreeId,
    branch: input().branch,
    baselineSha: 'a'.repeat(40)
  })
})
it('keeps both fresh prompt files and launch record byte-identical', async () => {
  const directory = await prepareHeadlessAttemptFiles(input())
  expect(await readFile(path.join(directory, 'prompt.md'))).toEqual(Buffer.from(input().prompt))
  expect(await readFile(path.join(input().worktree, '.axiom/prompt.md'))).toEqual(
    Buffer.from(input().prompt)
  )
  expect(await readFile(path.join(directory, 'launch.json'), 'utf8')).toBe(
    JSON.stringify({
      baselineSha: 'a'.repeat(40),
      worktreeId: input().worktreeId,
      branch: input().branch
    })
  )
})
