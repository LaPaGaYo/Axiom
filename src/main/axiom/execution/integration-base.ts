import { mkdtemp, rmdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitObjectIdSchema } from '../../../shared/axiom-contract/submission-params'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'

export async function ensureIntegrationBase(input: {
  repoPath: string
  targetBranch: string
  missionId: string
}) {
  const options = gitOptionsForWorktree(input.repoPath)
  const branch = `axiom/integration/${input.missionId}`
  let existingSha: string | undefined
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      options
    )
    existingSha = stdout.trim()
  } catch (error) {
    // Quiet rev-parse exits 1 for an absent ref; host/repository failures must not create one.
    if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 1)) {
      throw new OrchestrationError(
        'integration_base_unavailable',
        'Cannot read the integration base.'
      )
    }
  }
  let sha: string
  try {
    sha = (
      await gitExecFileAsync(['rev-parse', '--verify', `refs/heads/${input.targetBranch}`], options)
    ).stdout.trim()
  } catch {
    throw new OrchestrationError('target_branch_not_found', 'Mission target branch was not found.')
  }
  if (existingSha !== undefined) {
    try {
      await gitExecFileAsync(
        ['merge-base', '--is-ancestor', existingSha, `refs/heads/${input.targetBranch}`],
        options
      )
    } catch (error) {
      const notAncestor =
        typeof error === 'object' && error !== null && 'code' in error && error.code === 1
      throw new OrchestrationError(
        'integration_base_unavailable',
        notAncestor
          ? 'The integration base is not an ancestor of the target branch.'
          : 'Cannot read the integration base.'
      )
    }
    return { sha: existingSha, created: false }
  }
  try {
    await gitExecFileAsync(['branch', branch, sha], options)
  } catch {
    throw new OrchestrationError(
      'integration_base_unavailable',
      'Cannot create the integration base.'
    )
  }
  return { sha, created: true }
}

export async function advanceIntegrationHead(input: {
  repoPath: string
  missionId: string
  from: string
  to: string
}): Promise<
  { advanced: true } | { advanced: false; reason: 'checked_out' | 'moved' | 'unavailable' }
> {
  const unavailable = { advanced: false, reason: 'unavailable' } as const
  const advanced = { advanced: true } as const
  const moved = { advanced: false, reason: 'moved' } as const
  try {
    const from = GitObjectIdSchema.parse(input.from)
    const to = GitObjectIdSchema.parse(input.to)
    const ref = `refs/heads/axiom/integration/${input.missionId}`
    const options = { ...gitOptionsForWorktree(input.repoPath), timeout: 30_000 }
    const read = async () => {
      const { stdout } = await gitExecFileAsync(
        ['for-each-ref', '--format=%(refname)%00%(objectname)%00%(symref)%00%(worktreepath)', ref],
        options
      )
      // A literal pattern also lists descendants; only this exact ref is ours to advance.
      const entry = stdout
        .split('\n')
        .map((line) => line.split('\0'))
        .find(([name]) => name === ref)
      if (!entry || entry[2]) {
        return undefined
      }
      return { commit: GitObjectIdSchema.parse(entry[1]), checkout: entry[3] }
    }
    const before = await read()
    if (!before) {
      return unavailable
    }
    if (before.commit === to) {
      return advanced
    }
    if (before.commit !== from) {
      return moved
    }
    if (before.checkout) {
      return { advanced: false, reason: 'checked_out' }
    }
    const hooksPath = await mkdtemp(path.join(tmpdir(), 'axiom-integration-head-hooks-'))
    try {
      try {
        await gitExecFileAsync(
          ['-c', `core.hooksPath=${hooksPath}`, 'update-ref', ref, to, from],
          options
        )
      } catch {
        // The readback decides, including a refused or interrupted write.
      }
      const after = await read()
      if (after?.commit === to) {
        return advanced
      }
      return !after || after.commit === from ? unavailable : moved
    } finally {
      await rmdir(hooksPath).catch(() => {})
    }
  } catch {
    return unavailable
  }
}
