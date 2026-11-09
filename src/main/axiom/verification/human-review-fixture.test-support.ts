import { rpcFixture } from '../rpc-fixture.test-support'
import { MissionController } from '../mission-controller/mission-controller'
import { planned } from '../mission-controller/controller-fixture.test-support'
import type { VerificationRunStatus } from '../../../shared/axiom-contract/lifecycle'
import type { VerificationAcceptance } from '../../../shared/axiom-contract/verification-acceptance'
import { vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'

export const humanAcceptance: VerificationAcceptance[] = [
  {
    index: 0,
    text: 'Command passes',
    check: { kind: 'command', command: 'node -e "0"' },
    result: 'pass',
    checkIndexes: [0],
    artifactIds: []
  },
  {
    index: 1,
    text: 'The example is clear',
    check: { kind: 'human' },
    result: 'human',
    checkIndexes: [],
    artifactIds: []
  }
]

export function humanReviewFixture(status: VerificationRunStatus = 'HUMAN_REVIEW') {
  const rpc = rpcFixture()
  getAxiomControlPlane(rpc.runtime).effects.start()
  vi.spyOn(getAxiomControlPlane(rpc.runtime).scheduler, 'scheduleRound').mockResolvedValue({
    admitted: [],
    skipped: []
  })
  const controller = new MissionController(rpc.db, rpc.store)
  const f = planned({ ...rpc, controller })
  controller.startExecution(f.missionId)
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'RUNNING',
    actor: 'Scheduler',
    reason: 'admission',
    attemptCountDelta: 1
  })
  controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'SUBMITTED',
    actor: 'AttemptSettlement',
    reason: 'submission'
  })
  controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'VERIFYING',
    actor: 'test',
    reason: 'claimed'
  })
  const candidate = f.store.insertCandidate({
    id: 'candidate',
    taskId: task.taskId,
    missionId: f.missionId,
    attemptId: 'attempt-1',
    commitSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    status: 'ACTIVE',
    supersededBy: null
  })
  const run = f.store.insertVerificationRun({
    id: 'z-original',
    taskId: task.taskId,
    missionId: f.missionId,
    candidateId: candidate.id,
    status,
    verdictDetail: {
      verdict: 'INCONCLUSIVE',
      reason: 'acceptance_human',
      escalation: 'human',
      acceptance: humanAcceptance
    },
    commands: [],
    toolVersions: {},
    verifier: 'VerificationService'
  })
  const snapshot = () =>
    ['verification_runs', 'task_stages', 'audit_events', 'mutation_receipts', 'axiom_effects'].map(
      (table) => f.db.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()
    )
  return { ...rpc, ...f, candidate, run, task, snapshot }
}
