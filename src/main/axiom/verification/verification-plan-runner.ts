import type { ArtifactStore } from '../artifacts/artifact-store'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import {
  matchesRetryOnce,
  matchesKnownFlaky,
  type VerificationCommand,
  type VerificationRules
} from '../../../shared/axiom-contract/verification-rules'
import { redactContext } from '../context-builder/redaction'
import { runVerificationCommand, skippedVerificationCommand } from './verification-command'
import { recordCommandEvidence, type CheckAttempt } from './verification-evidence'
import { boundVerificationText, verificationExcerpt } from './verification-output'

export type VerificationCheck = VerificationCommand &
  CheckAttempt & { index: number; attempts: CheckAttempt[] }
type PlanInput = {
  artifacts: ArtifactStore
  run: VerificationRun
  plan: VerificationCommand[]
  rules: VerificationRules
  cwd: string
  deadline: number
  signal?: AbortSignal
  assertCurrent: () => void
}

export async function executeVerificationPlan(input: PlanInput) {
  const checks: VerificationCheck[] = []
  let setupFailed = false
  let excerptBytes = 32 * 1024
  const execute = async (command: string, deadline = input.deadline) => {
    input.assertCurrent()
    const result = await runVerificationCommand({
      command,
      cwd: input.cwd,
      deadline,
      signal: input.signal
    })
    input.assertCurrent()
    return recordCommandEvidence(input, result)
  }
  for (const [index, step] of input.plan.entries()) {
    input.assertCurrent()
    const first = setupFailed
      ? await recordCommandEvidence(input, skippedVerificationCommand('setup_failed'))
      : await execute(step.command)
    const attempts = first.result === 'skipped' ? [] : [first]
    let outcome = { ...first }
    if (step.source === 'setup' && first.result !== 'pass' && first.result !== 'skipped') {
      setupFailed = true
      outcome = { ...first, result: 'environmental', reason: 'setup_failed' }
    } else if (first.result === 'fail' && matchesRetryOnce(step.command, input.rules.retryOnce)) {
      const second = await execute(step.command)
      attempts.push(second)
      // A failed/absent retry does not erase the first deterministic failure.
      if (second.result === 'pass') {
        outcome = { ...second, result: 'inconclusive', reason: 'flaky' }
      } else if (second.result === 'fail') {
        outcome = second
      }
    }
    const failures = [...new Set(attempts.flatMap((attempt) => attempt.failures))].slice(0, 20)
    if (
      outcome.result === 'fail' &&
      failures.length &&
      attempts.every((attempt) => attempt.result === 'fail') &&
      failures.every((failure) => matchesKnownFlaky(failure, input.rules.knownFlaky))
    ) {
      outcome = { ...outcome, result: 'inconclusive', reason: 'known_flaky' }
    }
    const excerpt = boundVerificationText(
      verificationExcerpt(
        attempts
          .map((a) => a.excerpt)
          .filter(Boolean)
          .join('\n')
      ),
      excerptBytes
    )
    excerptBytes -= Buffer.byteLength(excerpt)
    // Excerpts live once per check; retries retain their full log references and failure names.
    checks.push({
      ...step,
      command: redactContext(step.command).content,
      ...outcome,
      index,
      failures,
      excerpt,
      durationMs: attempts.reduce((sum, attempt) => sum + attempt.durationMs, 0),
      truncated: attempts.some((attempt) => attempt.truncated),
      attempts: attempts.map((attempt) => ({ ...attempt, excerpt: '' }))
    })
  }
  const toolVersions: Record<string, string> = {}
  const tools: (CheckAttempt & { command: string })[] = []
  for (const tool of ['node', 'pnpm', 'git']) {
    const command = `${tool} --version`
    const result = await execute(command, Math.min(input.deadline, Date.now() + 10_000))
    const output = result.stdoutArtifactId
      ? (await input.artifacts.read(result.stdoutArtifactId)).content.toString().trim()
      : ''
    toolVersions[tool] =
      result.result === 'pass' && output ? boundVerificationText(output, 1024) : 'unavailable'
    tools.push({ ...result, command, excerpt: '' })
  }
  return { checks, tools, toolVersions }
}
