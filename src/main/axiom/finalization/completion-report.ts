import {
  COMPLETION_REPORT_VERSION,
  CompletionReportSchema,
  type CompletionReport
} from '../../../shared/axiom-contract/completion-report'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import type { AxiomStore } from '../db/axiom-store'
import { completionGate, type FinalizationFacts } from './completion-gate'
import { completionReportTask } from './completion-report-tasks'

export function buildCompletionReport(
  store: AxiomStore,
  db: OrchestrationDb,
  missionId: string,
  facts: FinalizationFacts
): CompletionReport {
  const mission = store.getMission(missionId)
  const revisions = store.listGoalRevisions(missionId)
  const goal = revisions.find((revision) => revision.id === mission?.activeGoalRevisionId)
  if (!mission || !goal) {
    throw new Error('completion_report_goal_missing')
  }
  const taskRows = store.listTaskStages({ missionId })
  const tasks = taskRows.map((task) => completionReportTask(store, db, task))
  const risks: CompletionReport['risks'] = []
  for (const task of tasks) {
    for (const attempt of task.attempts) {
      if (attempt.posture === 'tui-bypass') {
        risks.push({ kind: 'bypass_posture', taskId: task.taskId, seq: attempt.seq })
      }
    }
    if (task.stage === 'INTEGRATED' && task.verification.resolution) {
      risks.push({
        kind: 'human_resolved_verification',
        taskId: task.taskId,
        runId: task.verification.runId
      })
    }
  }
  return CompletionReportSchema.parse({
    version: COMPLETION_REPORT_VERSION,
    mission: { id: mission.id, repoId: mission.repoId, targetBranch: mission.targetBranch },
    goal: {
      id: goal.id,
      revision: goal.revision,
      objective: goal.objective,
      constraints: goal.constraints,
      criteria: goal.acceptanceCriteria.map((text, index) => ({
        index,
        text,
        coveredBy: taskRows
          .filter(
            (task) => task.stage === 'INTEGRATED' && task.spec.coversGoalCriteria?.includes(index)
          )
          .map((task) => task.taskId)
      })),
      revisions: revisions.map(({ id, revision, status }) => ({ id, revision, status }))
    },
    plans: store.listPlanRevisions(missionId).map((plan) => ({
      id: plan.id,
      revision: plan.revision,
      status: plan.status,
      goalRevisionId: plan.goalRevisionId,
      ...(plan.supersedesId ? { supersedesId: plan.supersedesId } : {}),
      provenance: {
        kind: plan.provenance.kind,
        actor: plan.provenance.actor,
        ...(plan.provenance.model !== undefined ? { model: plan.provenance.model } : {})
      },
      taskIds: plan.tasks.map((task) => task.id),
      risks: plan.risks.map(({ id, description, mitigation }) => ({
        id,
        description,
        ...(mitigation !== undefined ? { mitigation } : {})
      }))
    })),
    tasks,
    decisions: store.listDecisions({ missionId }).map((decision) => decision.id),
    gate: completionGate(store, db, missionId, facts),
    commits: {
      integrationHead: facts.integrationHead,
      targetHead: facts.targetHead,
      promoted: store
        .listIntegrationBatches({ missionId })
        .filter((batch) => batch.status === 'PROMOTED')
        .map((batch) => batch.mergeCommit)
    },
    risks
  })
}
