import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import type { AcceptanceCriterion } from '../../../shared/axiom-contract/mission-objects'
import { verificationGitFixture } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'

let root: string
let f: Awaited<ReturnType<typeof verificationGitFixture>>
let service: VerificationService
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-acceptance-'))
  f = await verificationGitFixture(root)
  service = new VerificationService({
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime: f.runtime,
    runtimeEpoch: 'acceptance-test'
  })
})
afterEach(async () => {
  await service.stop()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
const passing: AcceptanceCriterion = {
  text: 'First passes',
  check: { kind: 'command', command: 'node -e "process.exit(0)"' }
}
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
    status: 'INCONCLUSIVE',
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
