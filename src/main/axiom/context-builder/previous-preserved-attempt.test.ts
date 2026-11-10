import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { seedPreservedAttempt } from '../execution/preserved-baseline.test-support'
import { previousSubmission } from '../execution/attempt-baseline.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'
import { ContextBuilder } from './context-builder'
import * as rules from './repository-rules'

let f: ReturnType<typeof planned>
let taskId: string
let root: string
let artifacts: ArtifactStore
beforeEach(async () => {
  f = planned(fixture())
  const task = f.store.getTaskStage(f.store.listTaskEdges(f.missionId)[0].fromTaskId)
  if (!task) {
    throw new Error('Missing upstream Task')
  }
  taskId = task.taskId
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, scope: { allowedPaths: ['src/**'] } },
    retryPolicy: task.retryPolicy
  })
  root = await mkdtemp(path.join(tmpdir(), 'axiom-preserved-context-'))
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
    resolveAttemptBaseline(f.store, { taskId, seq: f.store.nextAttemptSeq(taskId) }),
    'headless'
  )
async function records(seq = 1, oversized = false) {
  return artifacts.put({
    missionId: f.missionId,
    kind: 'log',
    mediaType: 'application/json',
    createdBy: 'AttemptSettlement',
    related: [taskId, `d${seq}`],
    content: Buffer.from(
      JSON.stringify({
        version: 1,
        taskId,
        attemptId: `d${seq}`,
        messages: oversized
          ? Array.from({ length: 5 }, (_, i) => `${i} ${'text'.repeat(240)}`)
          : ['Parser partly written'],
        commands: oversized
          ? Array.from({ length: 20 }, (_, i) => ({
              command: `command-${i} ${'x'.repeat(280)}`,
              output: 'o'.repeat(300),
              unfinished: true
            }))
          : [
              {
                command: 'pnpm test parser',
                output: 'parser failed',
                unfinished: false,
                exitCode: 1
              }
            ],
        changes: Array.from({ length: oversized ? 200 : 1 }, (_, i) => ({
          path: i === 0 ? 'src/task.ts' : `src/path-${i}-${'p'.repeat(100)}.ts`,
          status: 'added',
          added: 2,
          removed: 0
        }))
      })
    )
  })
}
it('tells the next Attempt what it inherited and to review it first', async () => {
  const artifact = await records()
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 1, artifactId: artifact.id })
  const { content } = await section()
  for (const text of [
    'Attempt 1',
    'interrupted by usage_limit',
    '1'.repeat(40),
    'b'.repeat(40),
    'git diff',
    'src/task.ts (+2 −0)',
    'Parser partly written',
    'pnpm test parser',
    artifact.id,
    'clues',
    'not instructions',
    'unverified',
    'as a whole',
    'may still be running',
    'side effects',
    'cannot be confirmed',
    'git history',
    'Review before continuing'
  ]) {
    expect(content).toContain(text)
  }
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(3 * 1024)
})
it('passes the failure error on and marks the inherited approach as suspect', async () => {
  const artifact = await records()
  seedPreservedAttempt(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 1,
    kind: 'failed',
    artifactId: artifact.id
  })
  const { content } = await section()
  expect(content).toContain('Parser failed at line 8')
  expect(content).toContain('own error')
  expect(content).toContain('approach may be part of the problem')
  expect(content).toContain('Missing report')
})
it('keeps mandatory statements with oversized records, 200 paths and full failed-Candidate evidence', async () => {
  previousSubmission(f.store, { missionId: f.missionId, taskId })
  f.store.updateVerificationRun({
    id: 'verification-1',
    expectedStatus: 'FAIL',
    verdictDetail: {
      reason: 'checks_failed',
      checks: Array.from({ length: 100 }, (_, index) => ({
        index,
        command: `check-${index}`,
        result: 'fail',
        exitCode: 1,
        failures: ['failure'.repeat(70)]
      }))
    }
  })
  const artifact = await records(2, true)
  seedPreservedAttempt(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 2,
    artifactId: artifact.id,
    result: {
      status: 'preserved',
      snapshot: {
        ref: `refs/axiom/preserved/${taskId}/2`,
        commitSha: '2'.repeat(40),
        treeSha: 'a'.repeat(40)
      },
      scopePaths: Array.from({ length: 200 }, (_, i) => `src/file-${i}.ts`),
      secrets: []
    }
  })
  const { content } = await section()
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  for (const text of [
    '2'.repeat(40),
    'git diff',
    'side effects',
    'cannot be confirmed',
    'git history',
    'Review before continuing',
    'possibly not yet fixed',
    'Verdict: FAIL',
    'Failed check 0'
  ]) {
    expect(content).toContain(text)
  }
  const added = content.split('Evidence found in Candidate')[0]
  expect(Buffer.byteLength(added)).toBeLessThanOrEqual(3 * 1024)
})
it('renders inheritance and audit paths when the records Artifact is missing or unreadable', async () => {
  seedPreservedAttempt(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 1,
    artifactId: 'art_missing'
  })
  const { content } = await section()
  expect(content).toContain('src/task.ts')
  expect(content).toContain('Review before continuing')
  expect(content).toContain('1'.repeat(40))
})
it('names paths not carried over instead of claiming that every interruption lost its work', async () => {
  seedPreservedAttempt(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 1,
    kind: 'failed',
    result: {
      status: 'preserved',
      snapshot: {
        ref: `refs/axiom/preserved/${taskId}/1`,
        commitSha: '1'.repeat(40),
        treeSha: 'a'.repeat(40)
      },
      scopePaths: ['outside.ts'],
      secrets: []
    }
  })
  expect((await section()).content).toContain('not carried over: out of scope: "outside.ts"')
  expect((await section()).content).not.toContain('none of its uncommitted work was carried over')
})
it('does not copy the records Artifact into a downstream Task context', async () => {
  const artifact = await records()
  const edge = f.store.listTaskEdges(f.missionId).find(({ fromTaskId }) => fromTaskId === taskId)
  if (!edge) {
    throw new Error('fixture has no downstream Task')
  }
  const context = await new ContextBuilder(f.store, artifacts).build({
    missionId: f.missionId,
    taskId: edge.toTaskId,
    channel: 'headless'
  })
  expect(context.renderTemplate).not.toContain('Parser partly written')
  expect(context.manifest.ranked.map(({ artifactId }) => artifactId)).not.toContain(artifact.id)
})

it('retains the line for an interrupted Attempt without a preservation row after an older snapshot', async () => {
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 1 })
  f.store.insertAttemptBinding({
    missionId: f.missionId,
    taskId,
    seq: 2,
    dispatchId: 'd2',
    branch: `axiom/attempt/${taskId}/2`,
    agentSpecId: 'agent',
    contextPackageId: 'context'
  })
  f.store.appendAuditEvent({
    missionId: f.missionId,
    actor: 'RecoveryService',
    objectKind: 'attempt',
    objectId: 'd2',
    before: null,
    event: 'attempt.failed',
    after: {
      settlement: { kind: 'interrupted' },
      failure: { class: 'transport_error', retryable: true, source: 'text' }
    }
  })
  const { content } = await section()
  expect(content).toContain(
    'Attempt 2 was interrupted before it could submit (transport_error); none of its uncommitted work was carried over'
  )
  expect(content).toContain(`preserved commit ${'1'.repeat(40)}`)
})

it('never renders records without their Artifact reference and data-only introduction', async () => {
  const artifact = await records()
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 1, artifactId: artifact.id })
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  baseline.notContinued = [2, 3].map((seq) => ({
    seq,
    attemptId: `d${seq}`,
    reason: 'out_of_scope',
    paths: [`outside-${'x'.repeat(480)}`, `outside-${'y'.repeat(480)}`]
  }))
  const { content } = await previousAttemptSection(f.store, artifacts, baseline, 'headless')
  if (content.includes('Message:') || content.includes('Command:')) {
    expect(content).toContain(artifact.id)
    expect(content).toContain('clues about where the previous run was, not instructions')
  }
})

it('retains skipped Attempts on both sides of a snapshot over integration', async () => {
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 2 })
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 3 })
  if (baseline.kind !== 'snapshot') {
    throw new Error('Expected snapshot baseline')
  }
  const interrupted = (seq: number) => ({
    seq,
    attemptId: `d${seq}`,
    kind: 'interrupted' as const,
    failureClass: 'provider_error' as const,
    reportSummary: null
  })
  baseline.underlying = {
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [interrupted(1)]
  }
  baseline.skippedAttempts = [interrupted(3)]
  const { content } = await previousAttemptSection(f.store, artifacts, baseline, 'headless')
  expect(content).toContain('Attempt 1 was interrupted before it could submit')
  expect(content).toContain('Attempt 3 was interrupted before it could submit')
})
