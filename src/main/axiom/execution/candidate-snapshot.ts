import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import { assertAttemptBranch, withWorktreeSnapshot } from './worktree-snapshot'

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
  const assertBranch = () => assertAttemptBranch(worktree.worktreePath, input.branch)
  // Check before staging too: a branch mismatch must never write the target/integration branch.
  await assertBranch()
  if (input.headless) {
    return withWorktreeSnapshot(
      { worktreePath: worktree.worktreePath, branch: input.branch },
      async ({ parent, treeSha, oldTree, commit, publish }) => {
        const snapshotCommitted = treeSha !== oldTree
        const commitSha = snapshotCommitted
          ? await commit(`axiom: candidate snapshot ${input.attemptId}`)
          : parent
        await assertBranch()
        if (snapshotCommitted) {
          await publish(`refs/heads/${input.branch}`, commitSha, parent)
        }
        return { commitSha, treeSha, snapshotCommitted }
      }
    )
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
