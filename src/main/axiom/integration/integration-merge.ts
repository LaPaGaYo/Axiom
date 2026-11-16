import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { IntegrationBatch } from '../../../shared/axiom-contract/integration-batch'
import { redactContext } from '../context-builder/redaction'

export async function readIntegrationGit(cwd: string, args: string[]): Promise<string> {
  return (await gitExecFileAsync(args, { ...gitOptionsForWorktree(cwd), timeout: 30_000 })).stdout
}

export async function writeIntegrationGit(
  cwd: string,
  args: string[],
  env?: NodeJS.ProcessEnv
): Promise<void> {
  const hooksPath = await mkdtemp(path.join(tmpdir(), 'axiom-integration-hooks-'))
  try {
    await gitExecFileAsync(['-c', `core.hooksPath=${hooksPath}`, ...args], {
      ...gitOptionsForWorktree(cwd),
      timeout: 120_000,
      ...(env ? { env } : {})
    })
  } finally {
    await rmdir(hooksPath)
  }
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
