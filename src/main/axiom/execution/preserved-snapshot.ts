import { stat } from 'node:fs/promises'
import { gitExecFileAsync, GitCommandTimeoutError } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { gitChangeListArgs, parseGitChangeList } from '../../../shared/git-change-list'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { redactContext } from '../context-builder/redaction'
import { readCandidateDiff } from '../verification/candidate-diff'
import { evaluateDiffGate } from '../verification/diff-gate'
import { assertAttemptBranch, withWorktreeSnapshot } from './worktree-snapshot'
import { PRESERVED_PATH_LIMIT, PRESERVATION_GIT_TIMEOUT_MS } from './preservation-policy'
import type { WorktreePreservation } from './preserved-snapshot-contract'

export type PreservationInput = {
  attemptId: string
  taskId: string
  seq: number
  missionId: string
  launch: { worktreePath: string; branch: string; baselineSha: string }
  allowedPaths: readonly string[]
  verificationRules: unknown
}

/** Best effort: immutable evidence may survive even if capture or settlement cannot finish. */
export async function preserveAttemptWorktree(
  input: PreservationInput
): Promise<WorktreePreservation> {
  const { launch } = input
  const ref = `refs/axiom/preserved/${input.taskId}/${input.seq}`
  let snapshot: { ref: string; commitSha: string } | undefined
  const unavailable = (
    reason: Extract<WorktreePreservation, { status: 'unavailable' }>['reason']
  ): WorktreePreservation => ({ status: 'unavailable', reason, ...(snapshot ? { snapshot } : {}) })
  try {
    if (!(await stat(launch.worktreePath).catch(() => undefined))?.isDirectory()) {
      return unavailable('worktree_missing')
    }
    const options = {
      ...gitOptionsForWorktree(launch.worktreePath),
      timeout: PRESERVATION_GIT_TIMEOUT_MS
    }
    const git = async (args: string[]) => (await gitExecFileAsync(args, options)).stdout.trim()
    await assertAttemptBranch(launch.worktreePath, launch.branch)
    // for-each-ref distinguishes an absent ref from a failed lookup, including timeouts.
    const existing = await git(['for-each-ref', '--format=%(refname) %(objectname)', ref])
    const entry = existing.split('\n').find((line) => line.startsWith(`${ref} `))
    const message = `axiom: preserved snapshot ${input.attemptId}`
    let treeSha: string
    if (entry) {
      snapshot = { ref, commitSha: GitObjectIdSchema.parse(entry.slice(ref.length + 1)) }
      if ((await git(['show', '-s', '--format=%B', snapshot.commitSha])) !== message) {
        return unavailable('ref_conflict')
      }
      treeSha = GitObjectIdSchema.parse(await git(['rev-parse', `${snapshot.commitSha}^{tree}`]))
    } else {
      const captured = await withWorktreeSnapshot(
        { ...launch, timeout: PRESERVATION_GIT_TIMEOUT_MS },
        async ({ treeSha, commit, publish }) => {
          const baselineTree = await git([
            'rev-parse',
            `${GitObjectIdSchema.parse(launch.baselineSha)}^{tree}`
          ])
          if (baselineTree === treeSha) {
            return undefined
          }
          const commitSha = await commit(message)
          snapshot = { ref, commitSha }
          await publish(ref, commitSha, '0'.repeat(commitSha.length))
          return { commitSha, treeSha }
        }
      )
      if (!captured) {
        return { status: 'empty' }
      }
      snapshot = { ref, commitSha: captured.commitSha }
      treeSha = captured.treeSha
    }
    const diff = await readCandidateDiff({
      cwd: launch.worktreePath,
      missionId: input.missionId,
      candidateCommitSha: snapshot.commitSha
    })
    if (!diff.ok) {
      return unavailable('diff_unavailable')
    }
    if (!diff.patchComplete) {
      return unavailable('diff_incomplete')
    }
    const parsedRules = VerificationRulesSchema.safeParse(input.verificationRules)
    const { secrets } = evaluateDiffGate({
      diff,
      allowedPaths: input.allowedPaths,
      rules: parsedRules.success ? parsedRules.data : VerificationRulesSchema.parse({})
    })
    const scopePaths = diff.changes.map(({ path }) => path).sort()
    const changes = parseGitChangeList(
      (await gitExecFileAsync(gitChangeListArgs(launch.baselineSha, snapshot.commitSha), options))
        .stdout
    )
    if (scopePaths.length > PRESERVED_PATH_LIMIT || changes.length > PRESERVED_PATH_LIMIT) {
      return unavailable('too_many_paths')
    }
    // A redacted filename is no longer a path identity and must never authorize continuation.
    if (
      [
        ...scopePaths,
        ...changes.flatMap(({ path, oldPath }) => (oldPath ? [path, oldPath] : [path]))
      ].some((path) => redactContext(path).redacted)
    ) {
      return unavailable('diff_unavailable')
    }
    return {
      status: 'preserved',
      snapshot: { ...snapshot, treeSha },
      scopePaths: scopePaths.map((path) => redactContext(path).content),
      secrets: secrets.map(({ path, pattern }) => ({ path: redactContext(path).content, pattern })),
      changes: changes.map((change) => ({
        ...change,
        path: redactContext(change.path).content,
        ...(change.oldPath ? { oldPath: redactContext(change.oldPath).content } : {})
      }))
    }
  } catch (error) {
    return unavailable(
      error instanceof GitCommandTimeoutError
        ? 'git_timeout'
        : error instanceof Error && error.message === 'candidate_branch_mismatch'
          ? 'branch_mismatch'
          : 'git_failure'
    )
  }
}
