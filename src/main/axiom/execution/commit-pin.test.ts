import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { gitExecFileAsync } from '../../git/runner'
import { pinCandidateRef, pinCommit } from './commit-pin'

let root: string
let worktree: string
let commitSha: string
let otherCommit: string
const branch = 'axiom/attempt/task/1'
const candidateId = 'cand_test'
const ref = `refs/axiom/candidates/${candidateId}`
const git = async (args: string[], cwd = root) =>
  (await gitExecFileAsync(args, { cwd })).stdout.trim()
const refs = () => git(['for-each-ref', '--format=%(refname) %(objectname)'])

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-commit-pin-'))
  await git(['init'])
  await writeFile(path.join(root, 'code.txt'), 'base')
  await git(['add', 'code.txt'])
  const commit = [
    '-c',
    'user.name=Fixture',
    '-c',
    'user.email=test@example.test',
    'commit',
    '--no-gpg-sign',
    '-m'
  ]
  await git([...commit, 'base'])
  otherCommit = await git(['rev-parse', 'HEAD'])
  worktree = path.join(root, 'worker')
  await git(['worktree', 'add', '-b', branch, worktree])
  await writeFile(path.join(worktree, 'code.txt'), 'candidate')
  await git(['add', 'code.txt'], worktree)
  await git([...commit, 'candidate'], worktree)
  commitSha = await git(['rev-parse', 'HEAD'], worktree)
  await writeFile(
    path.join(root, '.git', 'hooks', 'reference-transaction'),
    '#!/bin/sh\nexit 88\n',
    { mode: 0o755 }
  )
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

describe('create-only commit pins', () => {
  it('pins a candidate commit under refs/axiom/candidates without running repository hooks', async () => {
    const before = await refs()
    expect(await pinCandidateRef(`repo::${worktree}`, candidateId, commitSha)).toEqual({
      pinned: true,
      ref
    })
    expect(await git(['rev-parse', '--verify', ref])).toBe(commitSha)
    const after = (await refs()).split('\n')
    expect(after.filter((line) => !before.split('\n').includes(line))).toEqual([
      `${ref} ${commitSha}`
    ])
    expect(after.filter((line) => !line.startsWith(`${ref} `))).toEqual(before.split('\n'))
    expect(await git(['rev-parse', `refs/heads/${branch}`])).toBe(commitSha)
  })

  it('accepts an existing pin of the same commit and reports another commit as a conflict', async () => {
    expect(await pinCandidateRef(`repo::${worktree}`, candidateId, commitSha)).toEqual({
      pinned: true,
      ref
    })
    const before = await refs()
    expect(await pinCandidateRef(`repo::${worktree}`, candidateId, commitSha)).toEqual({
      pinned: true,
      ref
    })
    expect(await refs()).toBe(before)
    expect(await pinCandidateRef(`repo::${worktree}`, candidateId, otherCommit)).toEqual({
      pinned: false,
      ref,
      reason: 'ref_conflict'
    })
    expect(await git(['rev-parse', '--verify', ref])).toBe(commitSha)
    expect(await refs()).toBe(before)
  })

  it('answers unavailable when the id is unsafe or the worktree is gone', async () => {
    const before = await refs()
    for (const id of ['a/b', 'a..b', '.a', 'a b', '']) {
      expect(await pinCandidateRef(`repo::${worktree}`, id, commitSha)).toEqual({
        pinned: false,
        ref: `refs/axiom/candidates/${id}`,
        reason: 'unavailable'
      })
    }
    for (const id of [`repo::${path.join(root, 'gone')}`, 'repo::T01', 'repo::', 'repo']) {
      expect(await pinCandidateRef(id, candidateId, commitSha)).toEqual({
        pinned: false,
        ref,
        reason: 'unavailable'
      })
    }
    expect(await pinCommit({ cwd: root, ref: 'refs/heads/x', commitSha })).toEqual({
      pinned: false,
      ref: 'refs/heads/x',
      reason: 'unavailable'
    })
    expect(await pinCommit({ cwd: path.join(root, 'code.txt'), ref, commitSha })).toEqual({
      pinned: false,
      ref,
      reason: 'unavailable'
    })
    expect(await pinCommit({ cwd: root, ref, commitSha: 'not-an-object-id' })).toEqual({
      pinned: false,
      ref,
      reason: 'unavailable'
    })
    expect(await refs()).toBe(before)
  })
})
