import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import { redactContext } from '../redaction/redaction'
import { confinedGitEnv, withHooklessGit } from '../execution/hookless-git'

export async function readIntegrationGit(
  cwd: string,
  args: string[],
  allowParentRepository = false
): Promise<string> {
  return (
    await gitExecFileAsync(args, {
      ...gitOptionsForWorktree(cwd),
      timeout: 30_000,
      ...(!allowParentRepository ? { env: confinedGitEnv(cwd) } : {})
    })
  ).stdout
}

export async function writeIntegrationGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<void> {
  await withHooklessGit(
    cwd,
    { timeout: 120_000, confine: true, env },
    async ({ hooks, options }) => {
      await gitExecFileAsync([...hooks, ...args], options)
    }
  )
}

export type IntegrationMerge =
  | { kind: 'merged'; mergeCommit: string }
  | { kind: 'conflict'; conflicts: string[]; conflictCount: number; truncated: boolean }

export async function mergeIntegrationCandidate(
  cwd: string,
  batch: IntegrationBatch,
  candidate: { id: string; commitSha: string }
): Promise<IntegrationMerge> {
  let mergeHead = false
  try {
    const date = `${batch.createdAt.replace(' ', 'T')}Z`
    let succeeded = true
    try {
      await writeIntegrationGit(
        cwd,
        [
          '-c',
          'user.name=Axiom Control Plane',
          '-c',
          'user.email=axiom@localhost',
          '-c',
          'commit.gpgsign=false',
          '-c',
          'rerere.enabled=false',
          '-c',
          'gc.auto=0',
          '-c',
          'merge.log=false',
          '-c',
          'merge.verifySignatures=false',
          'merge',
          '--no-ff',
          '--no-edit',
          '--cleanup=verbatim',
          '-m',
          `axiom: integrate ${candidate.id}`,
          candidate.commitSha
        ],
        { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date }
      )
    } catch {
      succeeded = false
    }
    if (succeeded) {
      const head = (await readIntegrationGit(cwd, ['rev-parse', 'HEAD'])).trim()
      if (head === batch.baseCommit) {
        return { kind: 'merged', mergeCommit: head }
      }
      const parents = (await readIntegrationGit(cwd, ['show', '-s', '--format=%P', 'HEAD'])).trim()
      if (parents === `${batch.baseCommit} ${candidate.commitSha}`) {
        return { kind: 'merged', mergeCommit: head }
      }
    }
    try {
      await readIntegrationGit(cwd, ['rev-parse', '--verify', 'MERGE_HEAD'])
      mergeHead = true
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 128)) {
        throw error
      }
    }
    if (!succeeded && mergeHead) {
      const paths = (
        await readIntegrationGit(cwd, ['diff', '--name-only', '--diff-filter=U', '-z'])
      )
        .split('\0')
        .filter(Boolean)
      if (paths.length) {
        await writeIntegrationGit(cwd, ['merge', '--abort'])
        mergeHead = false
        return {
          kind: 'conflict',
          conflicts: paths.slice(0, 200).map((p) => redactContext(p).content),
          conflictCount: paths.length,
          truncated: paths.length > 200
        }
      }
    }
    throw new Error('merge_failed')
  } catch {
    if (mergeHead) {
      try {
        await writeIntegrationGit(cwd, ['merge', '--abort'])
      } catch {
        /* Removal still follows. */
      }
    }
    // Git and hooks may put repository content in stderr. Persist only this fixed code.
    throw new Error('merge_failed')
  }
}
