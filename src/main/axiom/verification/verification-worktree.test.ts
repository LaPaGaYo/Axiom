import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { pinVerificationCandidate } from './verification-worktree'
import { CandidateSchema } from '../../../shared/axiom-contract/submission-params'

let root: string
let candidate: ReturnType<typeof CandidateSchema.parse>
const branch = 'axiom/verify/vrun-1/1'
const git = async (...args: string[]) => (await gitExecFileAsync(args, { cwd: root })).stdout.trim()
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-verify-git-'))
  await git('init', '-q')
  await git('config', 'user.name', 'Verification test')
  await git('config', 'user.email', 'verification@localhost')
  await writeFile(path.join(root, 'file.txt'), 'candidate')
  await git('add', 'file.txt')
  await git('commit', '-qm', 'candidate')
  candidate = CandidateSchema.parse({
    id: 'candidate-1',
    missionId: 'mission-1',
    taskId: 'task-1',
    attemptId: 'attempt-1',
    status: 'ACTIVE',
    supersededBy: null,
    commitSha: await git('rev-parse', 'HEAD'),
    treeSha: await git('rev-parse', 'HEAD^{tree}'),
    createdAt: 'now',
    updatedAt: 'now'
  })
  await git('checkout', '-qb', branch)
  await writeFile(path.join(root, 'file.txt'), 'branch has moved since Candidate')
  await git('commit', '-qam', 'later')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

it('pins detached HEAD and its verification branch to the immutable commit, suppressing checkout hooks', async () => {
  await writeFile(
    path.join(root, '.git', 'hooks', 'post-checkout'),
    '#!/bin/sh\ntouch hook-ran\n',
    { mode: 0o700 }
  )
  await pinVerificationCandidate(`repo::${root}`, branch, candidate)
  expect(await git('rev-parse', 'HEAD')).toBe(candidate.commitSha)
  expect(await git('rev-parse', 'HEAD^{tree}')).toBe(candidate.treeSha)
  expect(await git('rev-parse', `refs/heads/${branch}`)).toBe(candidate.commitSha)
  await expect(git('symbolic-ref', '-q', 'HEAD')).rejects.toMatchObject({ code: 1 })
  await expect(access(path.join(root, 'hook-ran'))).rejects.toMatchObject({ code: 'ENOENT' })
})
it('distinguishes a missing commit from a mismatching tree', async () => {
  await expect(
    pinVerificationCandidate(`repo::${root}`, branch, { ...candidate, commitSha: '0'.repeat(40) })
  ).rejects.toMatchObject({ reason: 'candidate_missing' })
  await expect(
    pinVerificationCandidate(`repo::${root}`, branch, { ...candidate, treeSha: '0'.repeat(40) })
  ).rejects.toMatchObject({ reason: 'candidate_mismatch' })
})
