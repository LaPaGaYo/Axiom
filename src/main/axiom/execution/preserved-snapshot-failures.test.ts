import { rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { preservedRepository } from './preserved-snapshot.test-support'
import { preserveAttemptWorktree } from './preserved-snapshot'
import * as diffs from '../verification/candidate-diff'
import * as runner from '../../git/runner'

let f: Awaited<ReturnType<typeof preservedRepository>>
beforeEach(async () => {
  f = await preservedRepository()
  await writeFile(path.join(f.root, 'code.txt'), 'partial\n')
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(f.root, { recursive: true, force: true })
})
it('retains the ref and commit when the integration diff is unavailable', async () => {
  const result = await preserveAttemptWorktree({ ...f.input, missionId: 'missing' })
  expect(result).toMatchObject({
    status: 'unavailable',
    reason: 'diff_unavailable',
    snapshot: { ref: 'refs/axiom/preserved/t/1' }
  })
  expect(await f.git(['rev-parse', '--verify', 'refs/axiom/preserved/t/1'])).toMatch(
    /^[a-f0-9]{40}$/
  )
})
it('refuses an incomplete verification diff without exposing its contents', async () => {
  vi.spyOn(diffs, 'readCandidateDiff').mockResolvedValue({
    ok: true,
    integrationBase: { branch: 'axiom/integration/m', sha: f.baselineSha },
    mergeBase: f.baselineSha,
    candidateCommitSha: 'a'.repeat(40),
    changes: [],
    addedText: new Map(),
    removedText: new Map(),
    binary: [],
    patchComplete: false
  })
  expect(await preserveAttemptWorktree(f.input)).toMatchObject({
    status: 'unavailable',
    reason: 'diff_incomplete',
    snapshot: { ref: 'refs/axiom/preserved/t/1' }
  })
})
it.each([false, true])('turns a git failure or timeout into unavailable (%s)', async (timeout) => {
  const execute = runner.gitExecFileAsync
  vi.spyOn(runner, 'gitExecFileAsync').mockImplementation((args, options) => {
    if (args.includes('write-tree')) {
      return Promise.reject(
        timeout ? new runner.GitCommandTimeoutError(30_000) : new Error('private git output')
      )
    }
    return execute(args, options)
  })
  expect(await preserveAttemptWorktree(f.input)).toEqual({
    status: 'unavailable',
    reason: timeout ? 'git_timeout' : 'git_failure'
  })
})
