import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { CommandResult } from './verification-command'
import { extractFailureNames } from './verification-failures'
import { verificationExcerpt } from './verification-output'

export type CheckAttempt = Omit<CommandResult, 'stdout' | 'stderr'> & {
  stdoutArtifactId: string | null
  stderrArtifactId: string | null
  stdoutBytes: number
  stderrBytes: number
  truncated: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
  failures: string[]
  excerpt: string
}

export async function recordCommandEvidence(
  input: { artifacts: ArtifactStore; run: VerificationRun; assertCurrent: () => void },
  result: CommandResult
): Promise<CheckAttempt> {
  const { stdout, stderr, ...outcome } = result
  const save = async (content: string) => {
    input.assertCurrent()
    const artifact = await input.artifacts.put({
      missionId: input.run.missionId,
      kind: 'log',
      mediaType: 'text/plain',
      createdBy: 'VerificationService',
      related: [input.run.id, input.run.taskId, input.run.candidateId],
      content: Buffer.from(content)
    })
    input.assertCurrent()
    return artifact.id
  }
  const output = `${stdout.content}\n${stderr.content}`
  return {
    ...outcome,
    stdoutArtifactId: result.result === 'skipped' ? null : await save(stdout.content),
    stderrArtifactId: result.result === 'skipped' ? null : await save(stderr.content),
    stdoutBytes: stdout.originalBytes,
    stderrBytes: stderr.originalBytes,
    truncated: stdout.truncated || stderr.truncated,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    failures: extractFailureNames(output),
    excerpt:
      result.result === 'pass' || result.result === 'skipped' ? '' : verificationExcerpt(output)
  }
}
