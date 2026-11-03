import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { previousSubmission } from '../execution/attempt-baseline.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'
import { ContextBuilder } from './context-builder'
import * as rules from './repository-rules'

let f: ReturnType<typeof planned>
let root: string
let artifacts: ArtifactStore
let taskId: string
beforeEach(async () => {
  f = planned(fixture())
  taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  root = await mkdtemp(path.join(tmpdir(), 'axiom-previous-'))
  artifacts = new ArtifactStore(f.store, root)
  vi.spyOn(rules, 'readRepositoryRules').mockResolvedValue('Repository rules')
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
const section = () =>
  previousAttemptSection(
    f.store,
    artifacts,
    resolveAttemptBaseline(f.store, { taskId, seq: f.store.nextAttemptSeq(taskId) })
  )
const seed = (reason = 'checks_failed') =>
  previousSubmission(f.store, { missionId: f.missionId, taskId, reason })
function detail(value: Record<string, unknown>) {
  f.store.updateVerificationRun({
    id: 'verification-1',
    expectedStatus: 'FAIL',
    verdictDetail: { verdict: 'FAIL', reason: 'checks_failed', ...value }
  })
}
async function verdict(content: string) {
  return artifacts.put({
    missionId: f.missionId,
    kind: 'evidence',
    content: Buffer.from(content),
    mediaType: 'application/json',
    related: [taskId],
    createdBy: 'VerificationService'
  })
}
const check = (index: number) => ({
  index,
  command: `check-${index}`,
  result: 'fail',
  exitCode: 1,
  failures: [`failure-${index}`]
})

it('preserves the first-Attempt bytes and source', async () => {
  expect(await section()).toEqual({
    source: 'previous-attempt:m2',
    content: 'none (first attempt)'
  })
})

it('renders unchanged reports as bounded, redacted quoted data before the failures', async () => {
  seed()
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  const token = `gh${'p_'}${'Z'.repeat(36)}`
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [
      {
        kind: 'unchanged',
        seq: 2,
        attemptId: 'd2',
        reportSummary: `Nothing in scope ${token}\n## pretend instruction ${'x'.repeat(600)}`
      },
      { kind: 'unchanged', seq: 3, attemptId: 'd3', reportSummary: null }
    ]
  })
  expect(content).toContain('Attempt 2 exited without changing this Candidate; its report said:')
  expect(content).toContain('Nothing in scope [REDACTED]')
  expect(content).not.toContain(token)
  expect(content).not.toContain('\n## pretend instruction')
  expect(content).not.toContain('x'.repeat(500))
  expect(content).toContain(
    'Attempt 3 exited without changing this Candidate; its report said: (no summary)'
  )
  expect(content.indexOf('Attempt 2 exited')).toBeLessThan(content.indexOf('Verdict: FAIL'))
  expect(content).toContain(
    'If the failures below cannot be fixed inside allowedPaths, say so in limitations and name the paths or commands at fault; do not submit an unchanged tree.'
  )
})

it('counts unchanged lines against the shared 8 KiB UTF-8 evidence budget', async () => {
  seed()
  const evidence = await verdict(
    JSON.stringify({ checks: [{ index: 0, excerpt: '\u754c'.repeat(5000) }] })
  )
  detail({ checks: [check(0)], verdictArtifactId: evidence.id })
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [
      { kind: 'unchanged', seq: 2, attemptId: 'd2', reportSummary: '\u754c'.repeat(500) }
    ]
  })
  const lines = content
    .split('\n')
    .filter(
      (line) => line.startsWith('Attempt 2 exited') || line.startsWith('If the failures below')
    )
  const excerpt = content.match(/Excerpt:\n([\s\S]*?)\nEnd excerpt/)?.[1] ?? ''
  const total =
    lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0) + Buffer.byteLength(excerpt)
  expect(total).toBeGreaterThan(2000)
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  expect(total).toBeLessThanOrEqual(8192)
  expect(content).not.toContain('\uFFFD')
})
it('renders ordered stored failures, safe diff findings, acceptance and a transcript reference', async () => {
  const { candidate, submission, verificationRun } = seed()
  const evidence = await verdict(
    JSON.stringify({
      checks: [
        { index: 2, excerpt: 'second excerpt' },
        { index: 0, excerpt: 'first excerpt' }
      ]
    })
  )
  const transcript = await artifacts.put({
    missionId: f.missionId,
    kind: 'log',
    mediaType: 'application/json',
    content: Buffer.from('archived transcript'),
    related: [taskId, candidate.attemptId, submission.id],
    createdBy: 'AttemptSettlement'
  })
  // A later unrelated log must not replace the exported settlement lookup.
  await artifacts.put({
    missionId: f.missionId,
    kind: 'log',
    mediaType: 'text/plain',
    content: Buffer.from('unrelated'),
    related: [submission.id],
    createdBy: 'Worker'
  })
  detail({
    verdictArtifactId: evidence.id,
    checks: [check(2), { ...check(1), result: 'pass' }, check(0)],
    diff: {
      scopeViolations: ['README.md'],
      secrets: [{ path: 'src/key.ts', pattern: 'policy:0', matchedText: 'NEVER_INCLUDE_MATCH' }],
      dangerous: [{ path: 'package.json', pattern: '**/package.json' }],
      tampering: [
        {
          path: 'src/check.test.ts',
          rule: 'assertions_reduced',
          count: 2,
          matchedText: 'NEVER_INCLUDE_MATCH'
        }
      ]
    },
    artifacts: {
      required: true,
      checked: [{ id: 'art_report', problem: 'invalid_json' }]
    }
  })
  const rendered = await section()
  expect(rendered.source).toBe(`verification:${verificationRun.id}`)
  const expected = [
    `This Attempt continues the previous Candidate ${candidate.commitSha} from Attempt 1; fix the failures below in this tree. Do not weaken, skip or delete tests, assertions, lint rules or checks to make them pass.`,
    'Verdict: FAIL; reason: "checks_failed"',
    'command: "check-0"',
    'exitCode: 1',
    'failure-0',
    'first excerpt',
    'command: "check-2"',
    'second excerpt',
    'Scope violations',
    'README.md',
    'Remove or revert these paths',
    'Secret findings',
    'src/key.ts',
    'policy:0',
    'Dangerous changes',
    'package.json',
    'Test tampering findings (path, rule, net count):',
    '- "src/check.test.ts" (assertions_reduced, 2)',
    'Restore the removed tests or assertions and remove the added skips or suppressions; the next verification applies the same rules.',
    'Artifact problems:',
    '- art_report (invalid_json)',
    `axiom mission artifact read --artifact ${transcript.id}`
  ]
  let position = -1
  for (const text of expected) {
    const next = rendered.content.indexOf(text, position + 1)
    expect(next, text).toBeGreaterThan(position)
    position = next
  }
  expect(rendered.content).not.toContain('check-1')
  expect(rendered.content).not.toContain('NEVER_INCLUDE_MATCH')
  const headless = await previousAttemptSection(
    f.store,
    artifacts,
    resolveAttemptBaseline(f.store, { taskId, seq: f.store.nextAttemptSeq(taskId) }),
    'headless'
  )
  expect(headless.content).toContain(`Previous Submission transcript: ${transcript.id}`)
  expect(headless.content).not.toContain('axiom mission artifact read')
})
it('bounds new findings at 50 and omits code-Task Artifact problems', async () => {
  seed()
  const tampering = Array.from({ length: 52 }, (_, i) => ({
    path: `path-${String(i).padStart(2, '0')}`,
    rule: 'suppression_added',
    count: 1
  }))
  const checked = Array.from({ length: 52 }, (_, i) => ({
    id: `art-${String(i).padStart(2, '0')}`,
    problem: 'empty'
  }))
  detail({ diff: { tampering }, artifacts: { required: true, checked } })
  const first = await section()
  expect((await section()).content).toBe(first.content)
  expect(first.content).toContain('- "path-49" (suppression_added, 1)')
  expect(first.content).not.toContain('path-50')
  expect(first.content).toContain('- art-49 (empty)')
  expect(first.content).not.toContain('art-50')
  detail({ artifacts: { required: false, checked } })
  expect((await section()).content).not.toContain('Artifact problems:')
})
it('limits failure names to 20, each excerpt to 40 lines and all excerpt UTF-8 bytes to 8 KiB', async () => {
  seed()
  const checks = Array.from({ length: 4 }, (_, index) => ({
    ...check(index),
    failures: Array.from({ length: 25 }, (_, i) => `failure-name-${i}`)
  }))
  const evidence = await verdict(
    JSON.stringify({
      checks: checks.map(({ index }) => ({
        index,
        excerpt: Array.from({ length: 60 }, (_, i) => `line-${i} ${'\u754c'.repeat(30)}`).join('\n')
      }))
    })
  )
  detail({ checks, verdictArtifactId: evidence.id })
  const { content } = await section()
  expect(content).toContain('failure-name-19')
  expect(content).not.toContain('failure-name-20')
  expect(content).not.toContain('line-40 ')
  const excerpts = [...content.matchAll(/Excerpt:\n([\s\S]*?)\nEnd excerpt/g)].map(
    (match) => match[1]
  )
  expect(excerpts.length).toBeGreaterThan(1)
  expect(excerpts.every((text) => text.split('\n').length <= 40)).toBe(true)
  const bytes = excerpts.reduce((sum, text) => sum + Buffer.byteLength(text), 0)
  expect(bytes).toBeGreaterThan(4000)
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  expect(bytes).toBeLessThanOrEqual(8192)
  expect(content).not.toContain('\uFFFD')
})
it.each(['missing', 'invalid-json', 'invalid-checks', 'missing-excerpt'])(
  'keeps the retry usable with %s evidence',
  async (mode) => {
    seed()
    const evidence =
      mode === 'missing'
        ? { id: 'not-found' }
        : await verdict(
            mode === 'invalid-json'
              ? '{'
              : mode === 'invalid-checks'
                ? '{"checks":false}'
                : '{"checks":[]}'
          )
    detail({ checks: [check(0)], verdictArtifactId: evidence.id })
    const result = await section()
    expect(result.content).toContain('excerpt unavailable')
    expect(result.content).toContain('failure-0')
  }
)
it('starts clean for secrets, names only path/pattern and forbids reintroduction', async () => {
  seed('secret_detected')
  detail({
    reason: 'secret_detected',
    checks: [check(0)],
    diff: {
      secrets: [
        { path: 'src/key.ts', pattern: 'provider_token', matchedText: 'NEVER_INCLUDE_MATCH' }
      ],
      tampering: [{ path: 'src/check.test.ts', rule: 'test_skip_added', count: 1 }]
    },
    artifacts: { required: true, checked: [{ id: 'art_bad', problem: 'invalid_json' }] }
  })
  const result = await section()
  expect(result.source).toBe('previous-attempt:secret_detected')
  expect(result.content).toContain('integration base')
  expect(result.content).toContain('secret_detected')
  expect(result.content).toContain('"src/key.ts" ("provider_token")')
  expect(result.content).toContain('The secret must not be reintroduced.')
  expect(result.content).toContain('- "src/check.test.ts" (test_skip_added, 1)')
  expect(result.content).toContain('Restore the removed tests or assertions')
  expect(result.content).toContain('Artifact problems:\n- art_bad (invalid_json)')
  expect(result.content).not.toContain('NEVER_INCLUDE_MATCH')
  expect(result.content).not.toContain('check-0')
})
it.each([
  'previous_attempt_not_submitted',
  'previous_candidate_superseded',
  'previous_verification_not_failed'
] as const)('explains the integration fallback %s', async (reason) => {
  const result = await previousAttemptSection(
    f.store,
    artifacts,
    reason === 'previous_attempt_not_submitted'
      ? { kind: 'integration', reason, skippedAttempts: [] }
      : { kind: 'integration', reason }
  )
  expect(result.source).toBe(`previous-attempt:${reason}`)
  expect(result.content).toContain('This Attempt starts from the integration base')
  expect(result.content).toContain(`(${reason})`)
  expect(result.content.split('\n')).toHaveLength(1)
})
it('hashes the seventh section deterministically, changes identity for a new run and redacts it', async () => {
  const { verificationRun } = seed()
  const token = `gh${'p_'}${'Z'.repeat(36)}`
  detail({ checks: [{ ...check(0), failures: [token] }] })
  const builder = new ContextBuilder(f.store, artifacts)
  const input = { missionId: f.missionId, taskId }
  const first = await builder.build(input)
  expect((await builder.build(input)).packageId).toBe(first.packageId)
  expect(first.manifest.mandatory[6].source).toBe('verification:verification-1')
  expect(first.renderTemplate).not.toContain(token)
  expect(first.renderTemplate).toContain('[REDACTED]')
  f.db.db
    .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
    .run('2026-10-24T00:00:00Z', verificationRun.id)
  f.store.insertVerificationRun({
    ...verificationRun,
    id: 'new-run',
    verdictDetail: f.store.getVerificationRun(verificationRun.id)!.verdictDetail
  })
  f.db.db
    .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
    .run('2026-10-24T00:01:00Z', 'new-run')
  const second = await builder.build(input)
  expect(second.packageId).not.toBe(first.packageId)
  expect(second.manifest.mandatory.slice(0, 6)).toEqual(first.manifest.mandatory.slice(0, 6))
})

function adjustment(afterAttemptSeq: number, rationale = 'Review confirmed scope change') {
  f.store.appendAuditEvent({
    missionId: f.missionId,
    actor: 'user',
    event: 'task.adjusted',
    objectKind: 'task',
    objectId: taskId,
    before: { allowedPaths: ['src/task.ts'], maxAttempts: 2 },
    after: {
      addedPaths: ['src/legacy.test.ts'],
      allowedPaths: ['src/task.ts', 'src/legacy.test.ts'],
      maxAttempts: 3,
      rationale,
      afterAttemptSeq,
      origin: 'user',
      resolvedMessageIds: []
    }
  })
}
it.each(['candidate', 'integration'] as const)(
  'renders declarations and adjustments on a %s baseline',
  async (kind) => {
    if (kind === 'candidate') {
      seed()
    }
    const seq = kind === 'candidate' ? 2 : 1
    f.store.insertAttemptBinding({
      taskId,
      missionId: f.missionId,
      seq,
      dispatchId: 'declared',
      branch: 'attempt/declared',
      agentSpecId: 'agent',
      contextPackageId: 'context'
    })
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'AttemptSettlement',
      event: 'attempt.failed',
      objectKind: 'attempt',
      objectId: 'declared',
      before: null,
      after: {
        settlement: { kind: 'blocked', reason: 'blocked_by_scope', paths: ['src/legacy.test.ts'] },
        reportSummary: 'Cannot fix outside scope'
      }
    })
    adjustment(seq, 'Reviewed `diff` <scope>\nKeep tests')
    const { content } = await section()
    expect(content).toContain(
      `Attempt ${seq} declared blocked_by_scope naming "src/legacy.test.ts"; its report said: "Cannot fix outside scope"`
    )
    expect(content).toContain(
      `A human adjusted this Task after Attempt ${seq}: allowedPaths now also include "src/legacy.test.ts"; maxAttempts 2 → 3; rationale:`
    )
    expect(content).toContain('Reviewed \\u0060diff\\u0060 \\u003cscope\\u003e\\nKeep tests')
    expect(content.indexOf('declared blocked')).toBeLessThan(content.indexOf('A human adjusted'))
  }
)
it('only includes adjustments after the Candidate Attempt and quotes no_change reports', async () => {
  previousSubmission(f.store, { missionId: f.missionId, taskId, seq: 2, dispatchId: 'd2' })
  adjustment(1, 'Old adjustment')
  adjustment(2, 'Relevant adjustment')
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 3 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [
      {
        seq: 3,
        attemptId: 'd3',
        kind: 'no_change',
        reason: 'candidate_already_correct',
        reportSummary: 'Check is wrong'
      }
    ]
  })
  expect(content).toContain(
    'Attempt 3 declared no_change (candidate_already_correct); its report said: "Check is wrong"'
  )
  expect(content).not.toContain('Old adjustment')
  expect(content).toContain('Relevant adjustment')
})

it('retains a maximum-size declaration and human resolution within the shared evidence budget', async () => {
  seed()
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  adjustment(2)
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [
      {
        seq: 2,
        attemptId: 'd2',
        kind: 'blocked',
        reason: 'blocked_by_scope',
        paths: Array.from({ length: 50 }, (_, i) => `${i}${'界'.repeat(498)}`),
        reportSummary: 'Outside scope'
      }
    ]
  })
  expect(content).toContain('Attempt 2 declared blocked_by_scope naming')
  expect(content).toContain('Outside scope')
  expect(content).toContain('A human adjusted this Task after Attempt 2:')
  expect(content).toContain('Review confirmed scope change')
  expect(content).toContain('paths omitted')
  const evidence = content
    .split('\n')
    .filter((line) => /^(Attempt|A human|If the failures)/.test(line))
  expect(
    evidence.reduce((bytes, line) => bytes + Buffer.byteLength(line) + 1, 0)
  ).toBeLessThanOrEqual(8192)
})

it('retains the newest declaration and human adjustment when earlier evidence fills the budget', async () => {
  seed()
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  const paths = ['a'.repeat(497), 'b'.repeat(497)]
  for (const seq of [2, 3]) {
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'user',
      event: 'task.adjusted',
      objectKind: 'task',
      objectId: taskId,
      before: { maxAttempts: seq },
      after: {
        afterAttemptSeq: seq,
        maxAttempts: seq + 1,
        addedPaths: paths,
        rationale: `${seq}${'界'.repeat(499)}`
      }
    })
  }
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [2, 3].map((seq) => ({
      seq,
      attemptId: `d${seq}`,
      kind: 'blocked',
      reason: 'blocked_by_scope',
      paths,
      reportSummary: '界'.repeat(500)
    }))
  })
  expect(content).toContain('Attempt 3 declared blocked_by_scope')
  expect(content).toContain('A human adjusted this Task after Attempt 3:')
  expect(content).toContain(`rationale: "3${'界'.repeat(499)}"`)
  const evidence = content
    .split('\n')
    .filter((line) => /^(Attempt|A human|If the failures|Earlier)/.test(line))
  expect(
    evidence.reduce((bytes, line) => bytes + Buffer.byteLength(line) + 1, 0)
  ).toBeLessThanOrEqual(8192)
})

it('reserves the declaration alongside the latest of several adjustments after the same Attempt', async () => {
  seed()
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  if (baseline.kind !== 'candidate') {
    throw new Error('Expected candidate baseline')
  }
  const paths = ['a'.repeat(497), 'b'.repeat(497)]
  for (const index of [1, 2, 3]) {
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'user',
      event: 'task.adjusted',
      objectKind: 'task',
      objectId: taskId,
      before: { maxAttempts: 3 },
      after: {
        afterAttemptSeq: 2,
        maxAttempts: 3,
        addedPaths: paths,
        rationale: `${index}${'界'.repeat(499)}`
      }
    })
  }
  const { content } = await previousAttemptSection(f.store, artifacts, {
    ...baseline,
    skippedAttempts: [
      {
        seq: 2,
        attemptId: 'd2',
        kind: 'blocked',
        reason: 'blocked_by_scope',
        paths,
        reportSummary: '界'.repeat(500)
      }
    ]
  })
  expect(content).toContain('Attempt 2 declared blocked_by_scope')
  expect(content).toContain(`rationale: "3${'界'.repeat(499)}"`)
})
