import { mkdtemp, rmdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export async function snapshotCandidate(input: {
  attemptId: string
  worktreeId: string
  branch: string
  headless?: boolean
}) {
  const worktree = splitWorktreeIdForFilesystem(input.worktreeId)
  if (!worktree?.repoId || !worktree.worktreePath) {
    throw new OrchestrationError('invalid_argument', 'candidate_worktree_missing')
  }
  const options = gitOptionsForWorktree(worktree.worktreePath)
  const assertBranch = async () => {
    let branch: string
    try {
      branch = (await gitExecFileAsync(['symbolic-ref', '--short', 'HEAD'], options)).stdout.trim()
    } catch {
      throw new OrchestrationError('invalid_argument', 'candidate_branch_mismatch')
    }
    if (branch !== input.branch || !branch.startsWith('axiom/attempt/')) {
      throw new OrchestrationError('invalid_argument', 'candidate_branch_mismatch')
    }
  }
  // Check before staging too: a branch mismatch must never write the target/integration branch.
  await assertBranch()
  if (input.headless) {
    // A private index ignores a sandbox-left index.lock without deleting anybody's lock.
    const directory = await mkdtemp(path.join(tmpdir(), 'axiom-snapshot-index-'))
    const isolated = {
      ...options,
      env: { ...process.env, GIT_INDEX_FILE: path.join(directory, 'index') }
    }
    const hooks = ['-c', `core.hooksPath=${directory}`]
    try {
      const parent = (await gitExecFileAsync(['rev-parse', 'HEAD'], options)).stdout.trim()
      await gitExecFileAsync(['read-tree', 'HEAD'], isolated)
      await gitExecFileAsync(['add', '-A', '--', '.', ':(exclude).axiom'], isolated)
      await gitExecFileAsync(['rm', '-r', '--cached', '--ignore-unmatch', '--', '.axiom'], isolated)
      const treeSha = GitObjectIdSchema.parse(
        (await gitExecFileAsync(['write-tree'], isolated)).stdout.trim()
      )
      const oldTree = (await gitExecFileAsync(['rev-parse', 'HEAD^{tree}'], options)).stdout.trim()
      const snapshotCommitted = treeSha !== oldTree
      const commitSha = GitObjectIdSchema.parse(
        snapshotCommitted
          ? (
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
                  `axiom: candidate snapshot ${input.attemptId}`
                ],
                isolated
              )
            ).stdout.trim()
          : parent
      )
      await assertBranch()
      if (snapshotCommitted) {
        await gitExecFileAsync(
          [...hooks, 'update-ref', `refs/heads/${input.branch}`, commitSha, parent],
          options
        )
      }
      return { commitSha, treeSha, snapshotCommitted }
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  }
  const status = await gitExecFileAsync(['status', '--porcelain'], options)
  const snapshotCommitted = status.stdout.trim().length > 0
  if (snapshotCommitted) {
    // --no-verify alone still runs prepare-commit-msg/post-commit. A per-call empty
    // hooks directory suppresses every hook without changing repository configuration.
    const hooksPath = await mkdtemp(path.join(tmpdir(), 'axiom-snapshot-hooks-'))
    const hooks = ['-c', `core.hooksPath=${hooksPath}`]
    try {
      await gitExecFileAsync([...hooks, 'add', '-A'], options)
      await gitExecFileAsync(
        [
          '-c',
          'user.name=Axiom Control Plane',
          '-c',
          'user.email=axiom@localhost',
          ...hooks,
          'commit',
          '--no-verify',
          '-q',
          '-m',
          `axiom: candidate snapshot ${input.attemptId}`
        ],
        options
      )
    } finally {
      await rmdir(hooksPath)
    }
  }
  const commitSha = GitObjectIdSchema.parse(
    (await gitExecFileAsync(['rev-parse', 'HEAD'], options)).stdout.trim()
  )
  const treeSha = GitObjectIdSchema.parse(
    (await gitExecFileAsync(['rev-parse', 'HEAD^{tree}'], options)).stdout.trim()
  )
  await assertBranch()
  return { commitSha, treeSha, snapshotCommitted }
}
