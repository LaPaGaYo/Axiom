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
    'Verdict: FAIL; reason: checks_failed',
    'command: check-0',
    'exitCode: 1',
    'failure-0',
    'first excerpt',
    'command: check-2',
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
    '- src/check.test.ts (assertions_reduced, 2)',
    'Restore the removed tests or assertions and remove the added skips or suppressions; the next verification applies the same rules.',
    'Artifact problems:',
    '- art_report (invalid_json)',
    'Not yet demonstrated',
    ...f.store.getTaskStage(taskId)!.spec.acceptanceCriteria,
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
  expect(first.content).toContain('- path-49 (suppression_added, 1)')
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
  expect(bytes).toBeGreaterThan(8000)
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
  expect(result.content).toContain('src/key.ts (provider_token)')
  expect(result.content).toContain('The secret must not be reintroduced.')
  expect(result.content).toContain('- src/check.test.ts (test_skip_added, 1)')
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
  const result = await previousAttemptSection(f.store, artifacts, { kind: 'integration', reason })
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
