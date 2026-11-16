import { lstat } from 'node:fs/promises'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import type { Candidate } from '../../../shared/axiom-contract/submission-params'
import type { VerificationDependencies } from './verification-service'
import { confinedGitEnv, withHooklessGit } from '../execution/hookless-git'

export class VerificationPreparationError extends Error {
  constructor(
    readonly reason: 'candidate_missing' | 'candidate_mismatch' | 'worktree_unavailable',
    detail: string
  ) {
    super(detail)
  }
}

export async function pinVerificationCandidate(
  worktreeId: string,
  branch: string,
  candidate: Candidate
): Promise<void> {
  const split = splitWorktreeIdForFilesystem(worktreeId)
  if (!split?.repoId || !split.worktreePath) {
    throw new VerificationPreparationError(
      'worktree_unavailable',
      'Invalid verification worktree identity.'
    )
  }
  const options = gitOptionsForWorktree(split.worktreePath)
  try {
    await gitExecFileAsync(['cat-file', '-e', `${candidate.commitSha}^{commit}`], options)
  } catch {
    throw new VerificationPreparationError(
      'candidate_missing',
      'Candidate commit is unavailable in the verification repository.'
    )
  }
  // Checkout must not run repository-controlled post-checkout hooks during verification preparation.
  await withHooklessGit(
    split.worktreePath,
    { timeout: undefined, confine: false },
    async ({ hooks, options }) => {
      await gitExecFileAsync([...hooks, 'checkout', '--detach', candidate.commitSha], options)
      await gitExecFileAsync(['branch', '-f', branch, candidate.commitSha], options)
    }
  )
  const commit = (await gitExecFileAsync(['rev-parse', 'HEAD'], options)).stdout.trim()
  const tree = (await gitExecFileAsync(['rev-parse', 'HEAD^{tree}'], options)).stdout.trim()
  const ref = (await gitExecFileAsync(['rev-parse', `refs/heads/${branch}`], options)).stdout.trim()
  let detached = false
  try {
    await gitExecFileAsync(['symbolic-ref', '-q', 'HEAD'], options)
  } catch (error) {
    // symbolic-ref exits 1 for detached HEAD; IO/other Git failures prove nothing.
    detached = error instanceof Error && 'code' in error && error.code === 1
  }
  if (
    commit !== candidate.commitSha ||
    tree !== candidate.treeSha ||
    ref !== candidate.commitSha ||
    !detached
  ) {
    throw new VerificationPreparationError(
      'candidate_mismatch',
      'Verification HEAD, tree, branch or detached identity does not match the Candidate.'
    )
  }
}

export async function removeVerificationWorktree(
  runtime: VerificationDependencies['runtime'],
  worktreeId: string,
  branch?: string
): Promise<void> {
  try {
    const cwd = splitWorktreeIdForFilesystem(worktreeId)?.worktreePath
    if (branch && cwd) {
      await lstat(path.join(cwd, '.git'))
      const options = {
        ...gitOptionsForWorktree(cwd),
        env: confinedGitEnv(cwd)
      }
      const ref = `refs/heads/${branch}`
      const [name, tip, occupied] = (
        await gitExecFileAsync(
          ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(worktreepath)', ref],
          options
        )
      ).stdout
        .trim()
        .split('\0')
      const head = (await gitExecFileAsync(['rev-parse', 'HEAD'], options)).stdout.trim()
      if (name === ref && tip === head && !occupied) {
        await withHooklessGit(
          cwd,
          { timeout: undefined, confine: true },
          async ({ hooks, options }) => {
            await gitExecFileAsync([...hooks, 'symbolic-ref', 'HEAD', ref], options)
          }
        )
      }
    }
  } catch {
    // Best effort: leave branch deletion to the kernel even when restoring HEAD is unavailable.
  }
  try {
    await runtime.removeManagedWorktree(`id:${worktreeId}`, { force: true })
  } catch (error) {
    // The runtime resolves recorded ids even after the directory disappeared. Only explicit absence is safe to ignore.
    if (
      !(
        error instanceof Error &&
        (['selector_not_found', 'worktree_not_found'].includes(error.message) ||
          ('code' in error && error.code === 'ENOENT'))
      )
    ) {
      throw error
    }
  }
}
