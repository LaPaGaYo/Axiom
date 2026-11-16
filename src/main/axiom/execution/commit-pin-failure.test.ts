import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as git from '../../git/runner'
import { pinCandidateRef, pinCommit } from './commit-pin'

let root: string
const ref = 'refs/axiom/candidates/cand_failure'
const commitSha = 'a'.repeat(64)
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-pin-failure-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  if (root) {
    await rm(root, { recursive: true, force: true })
  }
})

it('bounds pin writes and reports absent, descendant, malformed and unreadable refs without error text', async () => {
  const run = vi.spyOn(git, 'gitExecFileAsync')
  for (const readback of [
    '',
    `${ref}/child ${commitSha}\n`,
    `${ref} invalid-oid\n`,
    new Error('private git failure')
  ]) {
    run.mockReset().mockRejectedValueOnce(new Error('write failed'))
    if (readback instanceof Error) {
      run.mockRejectedValueOnce(readback)
    } else {
      run.mockResolvedValueOnce({ stdout: readback, stderr: '' })
    }
    expect(await pinCommit({ cwd: root, ref, commitSha })).toEqual({
      pinned: false,
      ref,
      reason: 'unavailable'
    })
    expect(run).toHaveBeenCalledTimes(2)
    expect(run.mock.calls[0]).toEqual([
      [
        '-c',
        expect.stringMatching(/^core\.hooksPath=/),
        'update-ref',
        ref,
        commitSha,
        '0'.repeat(64)
      ],
      { cwd: root, timeout: 30_000 }
    ])
    expect(run.mock.calls[1]).toEqual([
      ['for-each-ref', '--format=%(refname) %(objectname)', ref],
      { cwd: root, timeout: 30_000 }
    ])
    const hooks = run.mock.calls[0]?.[0][1]?.slice('core.hooksPath='.length)
    expect(hooks).toBeTruthy()
    if (!hooks) {
      throw new Error('Missing hooks path')
    }
    await expect(stat(hooks)).rejects.toMatchObject({ code: 'ENOENT' })
  }
})

it('rejects unsafe ids and non-absolute or missing worktrees before any git call', async () => {
  const run = vi.spyOn(git, 'gitExecFileAsync')
  for (const id of ['a/b', 'a..b', '.a', 'a b', '']) {
    expect(await pinCandidateRef(`repo::${root}`, id, commitSha)).toMatchObject({
      pinned: false,
      reason: 'unavailable'
    })
  }
  for (const worktreeId of ['repo', 'repo::', 'repo::T01', `repo::${path.join(root, 'gone')}`]) {
    expect(await pinCandidateRef(worktreeId, 'valid', commitSha)).toMatchObject({
      pinned: false,
      reason: 'unavailable'
    })
  }
  expect(await pinCommit({ cwd: root, ref: 'refs/heads/x', commitSha })).toMatchObject({
    pinned: false,
    reason: 'unavailable'
  })
  expect(run).not.toHaveBeenCalled()
})
