import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export async function assertAttemptBranch(worktreePath: string, expected: string) {
  let branch: string
  try {
    branch = (
      await gitExecFileAsync(
        ['symbolic-ref', '--short', 'HEAD'],
        gitOptionsForWorktree(worktreePath)
      )
    ).stdout.trim()
  } catch {
    throw new OrchestrationError('invalid_argument', 'candidate_branch_mismatch')
  }
  if (branch !== expected || !branch.startsWith('axiom/attempt/')) {
    throw new OrchestrationError('invalid_argument', 'candidate_branch_mismatch')
  }
}

/** Shared tree capture: only the private index is staged, including removal of host scratch files. */
export async function withWorktreeSnapshot<T>(
  input: { worktreePath: string; branch: string; timeout?: number },
  consume: (snapshot: {
    parent: string
    treeSha: string
    oldTree: string
    commit: (message: string) => Promise<string>
    publish: (ref: string, commitSha: string, expected: string) => Promise<void>
  }) => Promise<T>
): Promise<T> {
  await assertAttemptBranch(input.worktreePath, input.branch)
  const options = { ...gitOptionsForWorktree(input.worktreePath), timeout: input.timeout }
  // A private index tolerates a sandbox-left index.lock without touching that lock.
  const directory = await mkdtemp(path.join(tmpdir(), 'axiom-snapshot-index-'))
  const isolated = {
    ...options,
    env: { ...process.env, GIT_INDEX_FILE: path.join(directory, 'index') }
  }
  const hooks = ['-c', `core.hooksPath=${directory}`]
  try {
    const parent = GitObjectIdSchema.parse(
      (await gitExecFileAsync(['rev-parse', 'HEAD'], options)).stdout.trim()
    )
    await gitExecFileAsync(['read-tree', 'HEAD'], isolated)
    await gitExecFileAsync(['add', '-A', '--', '.', ':(exclude).axiom'], isolated)
    await gitExecFileAsync(['rm', '-r', '--cached', '--ignore-unmatch', '--', '.axiom'], isolated)
    const treeSha = GitObjectIdSchema.parse(
      (await gitExecFileAsync(['write-tree'], isolated)).stdout.trim()
    )
    const oldTree = (await gitExecFileAsync(['rev-parse', 'HEAD^{tree}'], options)).stdout.trim()
    return await consume({
      parent,
      treeSha,
      oldTree,
      commit: async (message) =>
        GitObjectIdSchema.parse(
          (
            await gitExecFileAsync(
              [
                ...hooks,
                '-c',
                'user.name=Axiom Control Plane',
                '-c',
                'user.email=axiom@localhost',
                'commit-tree',
                treeSha,
                '-p',
                parent,
                '-m',
                message
              ],
              isolated
            )
          ).stdout.trim()
        ),
      publish: async (ref, commitSha, expected) => {
        await assertAttemptBranch(input.worktreePath, input.branch)
        await gitExecFileAsync([...hooks, 'update-ref', ref, commitSha, expected], options)
      }
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
