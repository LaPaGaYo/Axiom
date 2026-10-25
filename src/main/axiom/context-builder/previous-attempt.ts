import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import type { ArtifactStore } from '../artifacts/artifact-store'
import type { AttemptBaseline } from '../execution/attempt-baseline'
import { findSubmissionTranscriptArtifactId } from '../execution/attempt-projection'
import { redactContext } from './redaction'

const Checks = z.array(
  z.object({
    index: z.number(),
    command: z.string(),
    result: z.string(),
    exitCode: z.number().nullable(),
    failures: z.array(z.string()).default([])
  })
)
const VerdictEvidence = z.object({
  checks: z.array(z.object({ index: z.number(), excerpt: z.string().optional() }))
})
const Findings = z.array(z.object({ path: z.string(), pattern: z.string() }))
const Diff = z.object({
  scopeViolations: z.array(z.string()).catch([]),
  secrets: Findings.catch([]),
  dangerous: Findings.catch([]),
  tampering: z
    .array(
      z.object({
        path: z.string(),
        rule: z.enum([
          'test_file_deleted',
          'test_skip_added',
          'assertions_reduced',
          'suppression_added'
        ]),
        count: z.number().int().positive()
      })
    )
    .catch([])
})
const ArtifactEvidence = z.object({
  required: z.boolean(),
  checked: z
    .array(
      z.object({
        id: z.string(),
        problem: z.enum(['unreadable', 'empty', 'invalid_utf8', 'invalid_json']).optional()
      })
    )
    .catch([])
})
const integrationReasons = {
  first_attempt: 'first Attempt',
  previous_attempt_not_submitted: 'the previous Attempt has no Submission',
  previous_candidate_superseded: 'the previous Candidate is no longer ACTIVE',
  previous_verification_not_failed: 'the previous Candidate has no latest FAIL verification',
  secret_detected: 'the previous Candidate history contains a detected secret'
}

function secretFindings(diff: unknown): string[] {
  const parsed = Diff.safeParse(diff)
  return parsed.success && parsed.data.secrets.length
    ? [
        'Secret findings (path and pattern only):',
        ...parsed.data.secrets.map(({ path, pattern }) => `- ${path} (${pattern})`)
      ]
    : []
}

function contentFindings(detail: Record<string, unknown>): string[] {
  const lines: string[] = []
  const diff = Diff.safeParse(detail.diff)
  if (diff.success) {
    if (diff.data.tampering.length) {
      lines.push(
        'Test tampering findings (path, rule, net count):',
        ...diff.data.tampering
          .slice(0, 50)
          .map(({ path, rule, count }) => `- ${path} (${rule}, ${count})`),
        'Restore the removed tests or assertions and remove the added skips or suppressions; the next verification applies the same rules.'
      )
    }
  }
  const artifactEvidence = ArtifactEvidence.safeParse(detail.artifacts)
  if (artifactEvidence.success && artifactEvidence.data.required) {
    const problems = artifactEvidence.data.checked.filter(({ problem }) => problem).slice(0, 50)
    if (problems.length) {
      lines.push('Artifact problems:', ...problems.map(({ id, problem }) => `- ${id} (${problem})`))
    }
  }
  return lines
}

async function readExcerpts(artifacts: ArtifactStore, artifactId: unknown) {
  try {
    if (typeof artifactId !== 'string') {
      return []
    }
    const { content } = await artifacts.read(artifactId)
    return VerdictEvidence.parse(JSON.parse(content.toString('utf8'))).checks
  } catch {
    // A missing/corrupt verdict Artifact must not prevent the next Attempt from fixing the Task.
    return []
  }
}

export async function previousAttemptSection(
  store: AxiomStore,
  artifacts: ArtifactStore,
  baseline: AttemptBaseline
): Promise<{ source: string; content: string }> {
  if (baseline.kind === 'integration') {
    if (baseline.reason === 'first_attempt') {
      return { source: 'previous-attempt:m2', content: 'none (first attempt)' }
    }
    const lines = [
      `This Attempt starts from the integration base because ${integrationReasons[baseline.reason]} (${baseline.reason}).`
    ]
    if (baseline.reason === 'secret_detected') {
      lines.push(
        ...secretFindings(baseline.verificationRun.verdictDetail.diff),
        'The secret must not be reintroduced.',
        ...contentFindings(baseline.verificationRun.verdictDetail)
      )
    }
    return { source: `previous-attempt:${baseline.reason}`, content: lines.join('\n') }
  }
  const { candidate, verificationRun: run, previousSeq } = baseline
  const detail = run.verdictDetail
  const lines = [
    `This Attempt continues the previous Candidate ${candidate.commitSha} from Attempt ${previousSeq}; fix the failures below in this tree. Do not weaken, skip or delete tests, assertions, lint rules or checks to make them pass.`,
    `Verdict: ${run.status}; reason: ${typeof detail.reason === 'string' ? detail.reason : 'unknown'}`
  ]
  const checks = Checks.safeParse(detail.checks)
  const excerpts = await readExcerpts(artifacts, detail.verdictArtifactId)
  let remaining = 8 * 1024
  for (const check of (checks.success ? checks.data : [])
    .filter((c) => c.result === 'fail')
    .sort((a, b) => a.index - b.index)) {
    lines.push(
      `Failed check ${check.index}`,
      `command: ${check.command}`,
      `exitCode: ${check.exitCode}`,
      'Failure names:',
      ...check.failures.slice(0, 20).map((name) => `- ${name}`)
    )
    const excerpt = excerpts.find((entry) => entry.index === check.index)?.excerpt
    if (excerpt === undefined) {
      lines.push('excerpt unavailable')
    } else if (remaining === 0) {
      lines.push('excerpt omitted (8 KiB total limit)')
    } else {
      const boundedLines = redactContext(excerpt).content.split(/\r?\n/).slice(0, 40).join('\n')
      // Streaming decode drops an incomplete final UTF-8 sequence without adding replacement bytes.
      const bounded = new TextDecoder().decode(Buffer.from(boundedLines).subarray(0, remaining), {
        stream: true
      })
      remaining -= Buffer.byteLength(bounded, 'utf8')
      lines.push(`Excerpt:\n${bounded}\nEnd excerpt`)
    }
  }
  const diff = Diff.safeParse(detail.diff)
  if (diff.success) {
    if (diff.data.scopeViolations.length) {
      lines.push(
        'Scope violations:',
        ...diff.data.scopeViolations.map((path) => `- ${path}`),
        'Remove or revert these paths. Scope is checked against the merge-base; leaving them in this tree fails again.'
      )
    }
    lines.push(...secretFindings(detail.diff))
    if (diff.data.dangerous.length) {
      lines.push(
        'Dangerous changes:',
        ...diff.data.dangerous.map(({ path, pattern }) => `- ${path} (${pattern})`)
      )
    }
  }
  lines.push(...contentFindings(detail))
  lines.push(
    'Not yet demonstrated:',
    ...(store.getTaskStage(run.taskId)?.spec.acceptanceCriteria ?? []).map(
      (criterion) => `- ${criterion}`
    )
  )
  const submission = store.getSubmissionByDispatch(candidate.attemptId)
  const transcript = submission
    ? findSubmissionTranscriptArtifactId(store, run.missionId, submission.id)
    : undefined
  if (transcript) {
    lines.push(
      `Previous Submission transcript: ${transcript}`,
      `axiom mission artifact read --artifact ${transcript}`
    )
  }
  return { source: `verification:${run.id}`, content: lines.join('\n') }
}
