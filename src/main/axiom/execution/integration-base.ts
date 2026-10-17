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
  try {
    const { stdout } = await gitExecFileAsync(
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      options
    )
    return { sha: stdout.trim(), created: false }
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
