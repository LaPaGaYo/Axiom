import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { seedPreservedAttempt } from '../execution/preserved-baseline.test-support'
import { resolveAttemptBaseline } from '../execution/attempt-baseline'
import { previousAttemptSection } from './previous-attempt'

let f: ReturnType<typeof planned>
let taskId: string
let root: string
let artifacts: ArtifactStore
beforeEach(async () => {
  f = planned(fixture())
  const task = f.store.getTaskStage(f.store.listTaskEdges(f.missionId)[0].fromTaskId)
  if (!task) {
    throw new Error('Missing Task')
  }
  taskId = task.taskId
  f.store.updateTaskSpec({
    taskId,
    expectedStage: task.stage,
    spec: { ...task.spec, scope: { allowedPaths: ['src/**'] } },
    retryPolicy: task.retryPolicy
  })
  root = await mkdtemp(path.join(tmpdir(), 'axiom-preserved-chain-'))
  artifacts = new ArtifactStore(f.store, root)
})
afterEach(async () => {
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

it('does not call a continued snapshot an integration restart when an older snapshot was unusable', async () => {
  // Attempt 1 left a file outside the scope, so Attempt 2 restarted from integration; Attempt 2 was
  // then interrupted with usable work, which Attempt 3 continues.
  seedPreservedAttempt(f.store, {
    missionId: f.missionId,
    taskId,
    seq: 1,
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
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 2 })
  const baseline = resolveAttemptBaseline(f.store, { taskId, seq: 3 })
  if (baseline.kind !== 'snapshot') {
    throw new Error('Expected a snapshot baseline')
  }
  expect(baseline.previousSeq).toBe(2)
  // What Attempt 2 itself did not inherit is its own history, not part of this baseline.
  expect(baseline.underlying).toEqual({
    kind: 'integration',
    reason: 'previous_attempt_not_submitted',
    skippedAttempts: [expect.objectContaining({ seq: 1, kind: 'interrupted' })]
  })
  expect(baseline.underlying).not.toHaveProperty('notContinued')
  const { content } = await previousAttemptSection(f.store, artifacts, baseline, 'headless')
  expect(content).toContain(`preserved commit ${'2'.repeat(40)}`)
  expect(content).not.toContain('starts from the integration base')
  expect(content).toContain('Attempt 1 was interrupted before it could submit')
})

it('quotes the end of a long recent message', async () => {
  const artifact = await artifacts.put({
    missionId: f.missionId,
    kind: 'log',
    mediaType: 'application/json',
    createdBy: 'AttemptSettlement',
    related: [taskId, 'd1'],
    content: Buffer.from(
      JSON.stringify({
        version: 1,
        taskId,
        attemptId: 'd1',
        messages: [`${'earlier reasoning '.repeat(50)}next I will wire the parser`],
        commands: [],
        changes: []
      })
    )
  })
  seedPreservedAttempt(f.store, { missionId: f.missionId, taskId, seq: 1, artifactId: artifact.id })
  const { content } = await previousAttemptSection(
    f.store,
    artifacts,
    resolveAttemptBaseline(f.store, { taskId, seq: 2 }),
    'headless'
  )
  expect(content).toContain('next I will wire the parser')
})
