import { z } from 'zod'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import { redactContext } from './redaction'

export async function readRepositoryRules(repoPath: string, targetBranch: string): Promise<string> {
  const rules: string[] = []
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    let text: string
    try {
      text = (
        await gitExecFileAsync(['show', `${targetBranch}:${name}`], gitOptionsForWorktree(repoPath))
      ).stdout
    } catch (error) {
      const failure = z.object({ stderr: z.string() }).safeParse(error)
      if (
        failure.success &&
        /does not exist in|exists on disk, but not in/.test(failure.data.stderr)
      ) {
        continue
      }
      // Missing files are optional; a broken repository/ref must never silently drop rules.
      throw new Error('context_repository_unavailable')
    }
    // Redact before capping so truncation cannot leave a partial private key in the prompt.
    const safe = redactContext(text)
    const bytes = Buffer.from(safe.content)
    const content = new TextDecoder('utf-8', { fatal: false }).decode(
      bytes.subarray(0, 16 * 1024),
      { stream: true }
    )
    rules.push(
      `### ${name}${safe.redacted ? ' [redacted]' : ''}${bytes.length > 16 * 1024 ? ' [capped at 16 KiB]' : ''}\n${content}`
    )
  }
  return rules.join('\n\n') || 'none found at target branch'
}
