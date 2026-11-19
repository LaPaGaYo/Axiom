import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from '../mission-controller/mission-controller'
import {
  makeProposal,
  goal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskStage } from '../../../shared/axiom-contract/lifecycle'
import {
  reportArtifacts,
  reportAttempt,
  reportSubmission
} from './completion-report-fixture.test-support'

export const integrationHead = 'a'.repeat(40)
export const targetHead = 'b'.repeat(40)
export const facts = { integrationHead, targetHead, targetContained: true }

export function finalizationFixture(db: OrchestrationDb, count = 2) {
  const store = new AxiomStore(db)
  const missions = new MissionController(db, store)
  const { mission, goalRevision } = missions.createMission({
    repoId: 'repo',
    repoPath: '/repository',
    targetBranch: 'main',
    goal,
    provenance
  })
  const proposal = makeProposal()
  const plan = missions.proposePlan({
    missionId: mission.id,
    provenance,
    planRevision: {
      ...proposal,
      goalRevisionId: goalRevision.id,
      edges: [],
      tasks: Array.from({ length: count }, (_, index) => ({
        ...proposal.tasks[0],
        id: `T${index}`,
        coversGoalCriteria: [0]
      }))
    }
  })
  missions.approvePlan({ planRevisionId: plan.id, resolver: 'tester', provenance })
  const f = { db, store, missions, missionId: mission.id, artifacts: reportArtifacts(store) }
  settleTasks(store, mission.id)
  missions.startExecution(mission.id)
  return { ...f, tasks: store.listTaskStages({ missionId: mission.id }) }
}

export function recordHead(store: AxiomStore, missionId: string, sha = integrationHead) {
  store.appendAuditEvent({
    missionId,
    actor: 'test',
    objectKind: 'mission',
    objectId: missionId,
    event: 'integration.base_created',
    before: null,
    after: { sha }
  })
}

export function setStage(store: AxiomStore, taskId: string, to: TaskStage) {
  const task = store.getTaskStage(taskId)!
  store.updateTaskStage({ taskId, from: task.stage, to })
}

export function settleTasks(store: AxiomStore, missionId: string) {
  store.transaction('fixture_settled', () => {
    for (const task of store.listTaskStages({ missionId })) {
      const taskId = task.taskId
      setStage(store, taskId, 'INTEGRATED')
      const candidateId = `candidate-${taskId}`
      const batchId = `batch-${taskId}`
      store.insertCandidate({
        id: candidateId,
        missionId,
        taskId,
        attemptId: `attempt-${taskId}`,
        commitSha: integrationHead,
        treeSha: targetHead,
        status: 'ACTIVE',
        supersededBy: null
      })
      reportAttempt(store, task)
      reportSubmission(store, task)
      store.insertVerificationRun({
        id: `run-${taskId}`,
        missionId,
        taskId,
        candidateId,
        status: 'PASS',
        verdictDetail: {},
        commands: [],
        toolVersions: {},
        verifier: 'test'
      })
      store.insertIntegrationBatch({
        id: batchId,
        missionId,
        baseCommit: targetHead,
        candidateIds: [candidateId],
        status: 'APPLYING'
      })
      store.transitionIntegrationBatch({
        id: batchId,
        expectedStatus: 'APPLYING',
        status: 'TESTING',
        mergeCommit: integrationHead
      })
      store.transitionIntegrationBatch({
        id: batchId,
        expectedStatus: 'TESTING',
        status: 'PROMOTABLE'
      })
      store.transitionIntegrationBatch({
        id: batchId,
        expectedStatus: 'PROMOTABLE',
        status: 'PROMOTED'
      })
      store.insertVerificationRun({
        id: `regression-${taskId}`,
        missionId,
        taskId,
        candidateId,
        batchId,
        status: 'PASS',
        verdictDetail: {},
        commands: [],
        toolVersions: {},
        verifier: 'test'
      })
    }
    recordHead(store, missionId)
  })
}
