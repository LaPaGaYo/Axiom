import { TERMINAL_TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'
import type { FinalizationGateItem } from '../../../shared/axiom-contract/mission-finalization'
import { planCoverage } from '../../../shared/axiom-contract/plan-coverage'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import { recordedIntegrationHead } from '../integration/integration-head'
import { activeCandidateVerification } from '../verification/verification-candidate'

export type FinalizationFacts = {
  integrationHead: string
  targetHead: string
  targetContained: boolean
}

export function completionGate(
  store: AxiomStore,
  db: OrchestrationDb,
  missionId: string,
  facts: FinalizationFacts
): FinalizationGateItem[] {
  const tasks = store.listTaskStages({ missionId })
  const integrated = tasks.filter((task) => task.stage === 'INTEGRATED')
  const verification = integrated.map((task) => ({
    taskId: task.taskId,
    ...activeCandidateVerification(store, task)
  }))
  const candidates = new Map(store.listCandidates(missionId).map((c) => [c.id, c.taskId]))
  const batches = new Map<string, ReturnType<AxiomStore['listIntegrationBatches']>[number]>()
  for (const batch of store.listIntegrationBatches({ missionId })) {
    const taskId = candidates.get(batch.candidateIds[0])
    if (taskId) {
      batches.set(taskId, batch)
    }
  }
  const unverified = verification.filter((v) => !v.candidate || v.latest?.status !== 'PASS')
  const unpromoted = integrated.filter((task) => {
    const batch = batches.get(task.taskId)
    const latest = batch && store.listVerificationRuns({ missionId, batchId: batch.id }).at(-1)
    return batch?.status !== 'PROMOTED' || latest?.status !== 'PASS'
  })
  const questions = tasks.filter((task) => {
    const question = store.hasPendingQuestionForTask(task.taskId)
    const typed = store.hasPendingTypedQuestionForTask(task.taskId)
    const gates = db.listGates({ taskId: task.taskId, status: 'pending' })
    return question || typed || gates.length > 0
  })
  const approval = store.hasBlockingApproval(missionId)
  const mission = store.getMission(missionId)
  const goal = mission?.activeGoalRevisionId
    ? store.getGoalRevision(mission.activeGoalRevisionId)
    : undefined
  const coverage = planCoverage(
    { tasks: integrated.map((task) => task.spec) },
    goal?.acceptanceCriteria ?? []
  )
  function item(
    id: FinalizationGateItem['id'],
    pass: boolean,
    evidence: string[],
    detail?: string
  ): FinalizationGateItem {
    return { id, pass, evidence: evidence.slice(0, 200), ...(detail ? { detail } : {}) }
  }
  return [
    item(
      'tasks_settled',
      integrated.length > 0 && tasks.every((task) => TERMINAL_TASK_STAGES.has(task.stage)),
      integrated.map((task) => task.taskId)
    ),
    item(
      'candidates_verified',
      unverified.length === 0,
      verification.flatMap((v) => (v.latest ? [v.latest.id] : [])),
      unverified.map((v) => v.taskId).join(', ')
    ),
    item(
      'batches_promoted',
      unpromoted.length === 0,
      integrated.flatMap((task) => {
        const batch = batches.get(task.taskId)
        return batch ? [batch.id] : []
      }),
      unpromoted.map((task) => task.taskId).join(', ')
    ),
    item(
      'integration_head_recorded',
      recordedIntegrationHead(store, missionId) === facts.integrationHead,
      [facts.integrationHead]
    ),
    item('target_branch_contained', facts.targetContained, [facts.targetHead]),
    item(
      'no_open_questions',
      questions.length === 0 && !approval,
      tasks.map((task) => task.taskId),
      approval ? 'blocking Approval' : questions.map((task) => task.taskId).join(', ')
    ),
    item(
      'goal_criteria_covered',
      Boolean(goal) && coverage.uncovered.length === 0,
      integrated.map((task) => task.taskId),
      !goal ? 'active Goal unavailable' : coverage.uncovered.map((index) => `#${index}`).join(', ')
    )
  ]
}
