import { EffectOutbox } from '../outbox/effect-outbox'
import { registerMissionEffectExecutors } from '../outbox/mission-effect-executors'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AcceptanceCriterion } from '../../../shared/axiom-contract/mission-objects'
import { verificationGitFixture } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { rerunVerification } from './verification-rerun'

let root: string
let f: Awaited<ReturnType<typeof verificationGitFixture>>
let service: VerificationService
let effects: EffectOutbox
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-acceptance-'))
  f = await verificationGitFixture(root)
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'acceptance-test' })
  service = new VerificationService({
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime: f.runtime,
    runtimeEpoch: 'acceptance-test'
  })
  registerMissionEffectExecutors({
    db: f.db,
    store: f.store,
    missions: f.controller,
    effects,
    launch: async () => {},
    verification: service
  })
  effects.start()
})
afterEach(async () => {
  await effects.stop()
  await service.stop()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
const passing: AcceptanceCriterion = {
  text: 'First passes',
  check: { kind: 'command', command: 'node -e "process.exit(0)"' }
}
it('executes a corrected plan on the same immutable Candidate without a new Attempt', async () => {
  f.store.updateTaskSpec({
    taskId: f.task.taskId,
    expectedStage: 'SUBMITTED',
    retryPolicy: f.task.retryPolicy,
    spec: {
      ...f.task.spec,
      acceptanceCriteria: [passing, { text: 'Person judges', check: { kind: 'human' } }]
    }
  })
  await service.kick()
  expect(f.store.getVerificationRun(f.run.id)?.status).toBe('HUMAN_REVIEW')
  const before = f.store.getCandidate(f.candidate.id)
  f.controller.adjustTask({
    taskId: f.task.taskId,
    acceptanceCriteria: [passing],
    rationale: 'The command proves the requirement.',
    actor: 'user'
  })
  const rerun = rerunVerification(
    { store: f.store, missions: f.controller, effects },
    { taskId: f.task.taskId, rationale: 'Recheck the corrected criteria.' }
  )
  await effects.kick()
  expect(f.store.getEffect('verification.enqueue', rerun.runId)?.status).toBe('done')
  await service.kick()
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'CANCELED',
    verdictDetail: { verdict: 'INCONCLUSIVE', reason: 'acceptance_human' }
  })
  expect(f.store.getVerificationRun(rerun.runId)).toMatchObject({
    status: 'PASS',
    candidateId: f.candidate.id,
    worktreeId: null,
    commands: [passing.check.kind === 'command' ? passing.check.command : ''],
    verdictDetail: {
      verdict: 'PASS',
      reason: 'checks_passed',
      acceptance: [{ index: 0, result: 'pass' }]
    }
  })
  expect(f.store.getCandidate(f.candidate.id)).toEqual(before)
  expect(f.store.getTaskStage(f.task.taskId)).toMatchObject({ stage: 'VERIFIED', attemptCount: 1 })
  expect(
    f.store.listAttemptBindings({ missionId: f.missionId, taskId: f.task.taskId })
  ).toHaveLength(1)
  expect(f.runtime.createManagedWorktree).toHaveBeenCalledTimes(2)
  expect(f.runtime.removeManagedWorktree).toHaveBeenCalledTimes(2)
})
it.each([
  {
    second: {
      text: 'Second fails',
      check: { kind: 'command', command: 'node -e "process.exit(1)"' }
    },
    status: 'FAIL',
    reason: 'checks_failed',
    results: ['pass', 'fail'],
    stage: 'READY'
  },
  {
    second: { text: 'Person judges', check: { kind: 'human' } },
    status: 'HUMAN_REVIEW',
    reason: 'acceptance_human',
    results: ['pass', 'human'],
    stage: 'VERIFYING'
  },
  {
    second: { text: 'Artifact required', check: { kind: 'artifact', artifactKind: 'evidence' } },
    status: 'FAIL',
    reason: 'artifact_missing',
    results: ['pass', 'fail'],
    stage: 'READY'
  }
] satisfies {
  second: AcceptanceCriterion
  status: string
  reason: string
  results: string[]
  stage: string
}[])(
  'persists and audits criterion evidence for $reason',
  async ({ second, status, reason, results, stage }) => {
    f.store.updateTaskSpec({
      taskId: f.task.taskId,
      expectedStage: 'SUBMITTED',
      retryPolicy: f.task.retryPolicy,
      spec: { ...f.task.spec, acceptanceCriteria: [passing, second] }
    })
    await service.kick()
    const saved = f.store.getVerificationRun(f.run.id)!
    expect(saved).toMatchObject({
      status,
      verdictDetail: {
        reason,
        acceptance: [
          { index: 0, ...passing, result: results[0], checkIndexes: [0], artifactIds: [] },
          {
            index: 1,
            ...second,
            result: results[1],
            checkIndexes: second.check.kind === 'command' ? [1] : [],
            artifactIds: []
          }
        ]
      }
    })
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe(stage)
    const artifactId = saved.verdictDetail.verdictArtifactId
    if (typeof artifactId !== 'string') {
      throw new Error('Missing verdict evidence')
    }
    const content = JSON.parse((await f.artifacts.read(artifactId)).content.toString())
    expect(content.acceptance).toEqual(saved.verdictDetail.acceptance)
    const event = f.store
      .listAuditEvents({ missionId: f.missionId })
      .find(
        (event) =>
          event.event ===
          `verification.${status.toLowerCase() === 'fail' ? 'failed' : 'inconclusive'}`
      )
    expect(event?.after).toMatchObject({ reason, acceptance: saved.verdictDetail.acceptance })
    expect(
      f.store.listAttemptBindings({ missionId: f.missionId, taskId: f.task.taskId })
    ).toHaveLength(1)
  }
)
