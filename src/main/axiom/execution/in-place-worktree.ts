import { stat } from 'node:fs/promises'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { withWorktreeSnapshot } from './worktree-snapshot'
import { PRESERVATION_GIT_TIMEOUT_MS } from './preservation-policy'
import type { ContinuationWorktree } from './in-place-continuation'

function worktreeGit(worktree: string) {
  return async (args: string[]) =>
    (
      await gitExecFileAsync(args, {
        ...gitOptionsForWorktree(worktree),
        timeout: PRESERVATION_GIT_TIMEOUT_MS
      })
    ).stdout.trim()
}

export async function inspectContinuationWorktree(input: {
  worktree: ContinuationWorktree['worktree']
  previousBranch: string
  branch: string
  baselineRef: string
  baselineSha: string
  snapshot?: { commitSha: string; treeSha: string }
}): Promise<ContinuationWorktree | undefined> {
  try {
    if (!(await stat(input.worktree.path)).isDirectory()) {
      return undefined
    }
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
  const git = worktreeGit(input.worktree.path)
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD'])
  if (branch !== input.previousBranch && branch !== input.branch) {
    return undefined
  }
  const targetCommit = input.snapshot?.commitSha ?? input.baselineSha
  if ((await git(['rev-parse', `${input.baselineRef}^{commit}`])) !== targetCommit) {
    return undefined
  }
  const parentCommit = input.snapshot ? await git(['rev-parse', `${targetCommit}^`]) : targetCommit
  const treeSha = await git(['rev-parse', `${targetCommit}^{tree}`])
  if (input.snapshot && treeSha !== input.snapshot.treeSha) {
    return undefined
  }
  return withWorktreeSnapshot(
    { worktreePath: input.worktree.path, branch, timeout: PRESERVATION_GIT_TIMEOUT_MS },
    async (tree) => {
      if (
        tree.parent !== (branch === input.branch ? targetCommit : parentCommit) ||
        tree.treeSha !== treeSha
      ) {
        return undefined
      }
      return { worktree: input.worktree, targetCommit, parentCommit, treeSha }
    }
  )
}

/** Only refs and the index change. Once mutation begins, errors belong to launch settlement. */
export async function takeOverContinuationWorktree(
  input: ContinuationWorktree,
  previousBranch: string,
  branch: string
) {
  const git = worktreeGit(input.worktree.path)
  const current = await git(['symbolic-ref', '--short', 'HEAD'])
  const head = await git(['rev-parse', 'HEAD'])
  if (current === branch && head === input.targetCommit) {
    // An earlier launch of this same Attempt already moved its branch.
  } else {
    if (current !== previousBranch || head !== input.parentCommit) {
      throw new Error('continuation_worktree_changed')
    }
    await git([
      'update-ref',
      `refs/heads/${branch}`,
      input.targetCommit,
      '0'.repeat(input.targetCommit.length)
    ])
    await git(['symbolic-ref', 'HEAD', `refs/heads/${branch}`])
  }
  await git(['read-tree', input.targetCommit])
  if (
    (await git(['symbolic-ref', '--short', 'HEAD'])) !== branch ||
    (await git(['rev-parse', 'HEAD'])) !== input.targetCommit ||
    (await git(['write-tree'])) !== (await git(['rev-parse', 'HEAD^{tree}']))
  ) {
    throw new Error('continuation_takeover_mismatch')
  }
}
