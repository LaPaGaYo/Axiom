import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { previousSubmission } from '../execution/attempt-baseline.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'
import { acceptanceLines, humanDispositionLines } from './previous-acceptance'
import { quote } from './previous-attempt-text'
import { ArtifactStore } from '../artifacts/artifact-store'
import { humanAcceptance } from '../verification/human-review-fixture.test-support'

let f: ReturnType<typeof planned>
beforeEach(() => {
  f = planned(fixture())
})
afterEach(() => f.db.close())
const rationale = 'The example must mention leap days.\n`<instruction>`'
const resolution = { verdict: 'FAIL', rationale, criteria: [1], by: 'user', at: 'now' }

it('adds no failure note for PASS and quotes a stored rerun rationale', () => {
  const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  const { verificationRun } = previousSubmission(f.store, { missionId: f.missionId, taskId })
  expect(
    humanDispositionLines(f.store, {
      ...verificationRun,
      verdictDetail: { resolution: { ...resolution, verdict: 'PASS' } }
    })
  ).toEqual([])
  expect(
    humanDispositionLines(f.store, {
      ...verificationRun,
      verdictDetail: { rerun: { rationale, by: 'user', at: 'now' } }
    })
  ).toEqual([
    `Verification was re-run on the same candidate after the criteria changed: ${quote(rationale)}`
  ])
})

it('replaces only human-selected criterion results with quoted failure rationale', () => {
  expect(acceptanceLines({ acceptance: humanAcceptance, resolution })).toEqual([
    '[pass] "Command passes"',
    `[fail] "The example is clear" — a human judged this failed: ${quote(rationale)}`
  ])
  expect(
    acceptanceLines({ acceptance: humanAcceptance, resolution: { ...resolution, verdict: 'PASS' } })
  ).toEqual(acceptanceLines({ acceptance: humanAcceptance }))
})

it.each(['tui', 'headless'] as const)(
  'includes the human verdict, rerun and criteria replacement in %s context',
  async (channel) => {
    const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
    const { verificationRun } = previousSubmission(f.store, { missionId: f.missionId, taskId })
    const rerunRationale = 'The plan asked for the wrong command.'
    f.store.updateVerificationRun({
      id: verificationRun.id,
      expectedStatus: 'FAIL',
      verdictDetail: {
        verdict: 'INCONCLUSIVE',
        reason: 'acceptance_human',
        acceptance: humanAcceptance,
        resolution
      }
    })
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'VerificationService',
      objectKind: 'verification_run',
      objectId: verificationRun.id,
      event: 'verification.rerun_requested',
      before: null,
      after: {
        taskId,
        rationale: rerunRationale,
        candidateId: verificationRun.candidateId,
        newRunId: verificationRun.id,
        previousRunId: 'previous'
      }
    })
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'user',
      objectKind: 'task',
      objectId: taskId,
      event: 'task.adjusted',
      before: { maxAttempts: 2, acceptanceCriteria: humanAcceptance },
      after: {
        afterAttemptSeq: 1,
        addedPaths: [],
        maxAttempts: 2,
        acceptanceCriteria: [humanAcceptance[0]],
        rationale: 'Corrected criteria.'
      }
    })
    const { content } = await previousAttemptSection(
      f.store,
      new ArtifactStore(f.store, '/unused'),
      resolveAttemptBaseline(f.store, { taskId, seq: 2 }),
      channel
    )
    expect(content).toContain(
      `A human resolved verification run ${verificationRun.id} as FAIL: ${quote(rationale)}`
    )
    expect(content).toContain(
      `[fail] "The example is clear" — a human judged this failed: ${quote(rationale)}`
    )
    expect(content).toContain(
      `Verification was re-run on the same candidate after the criteria changed: ${quote(rerunRationale)}`
    )
    expect(content).toContain('acceptance criteria replaced (2 → 1)')
    expect(content).not.toContain('a person confirms this')
    expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
  }
)

it('reserves the human disposition before admitting long adjustment history', async () => {
  const taskId = f.store.listTaskStages({ missionId: f.missionId })[0].taskId
  const { verificationRun } = previousSubmission(f.store, { missionId: f.missionId, taskId })
  f.store.updateVerificationRun({
    id: verificationRun.id,
    expectedStatus: 'FAIL',
    verdictDetail: { acceptance: humanAcceptance, resolution }
  })
  for (let index = 0; index < 25; index++) {
    f.store.appendAuditEvent({
      missionId: f.missionId,
      actor: 'user',
      objectKind: 'task',
      objectId: taskId,
      event: 'task.adjusted',
      before: { maxAttempts: 2 },
      after: { afterAttemptSeq: 1, addedPaths: [], maxAttempts: 2, rationale: 'x'.repeat(500) }
    })
  }
  const { content } = await previousAttemptSection(
    f.store,
    new ArtifactStore(f.store, '/unused'),
    resolveAttemptBaseline(f.store, { taskId, seq: 2 })
  )
  expect(content).toContain('A human resolved verification run')
  expect(content).toContain('a human judged this failed')
  expect(content).toContain(quote(rationale))
  expect(Buffer.byteLength(content)).toBeLessThanOrEqual(8192)
})
