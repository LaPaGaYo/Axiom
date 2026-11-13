import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'

/** Called inside the scheduler precheck/admission transaction. */
export function blockTaskTokenBudget(
  store: AxiomStore,
  missions: MissionController,
  task: TaskStageRecord,
  now: () => string
): boolean {
  const limit = task.spec.budget?.maxTokens
  if (limit === undefined) {
    return false
  }
  const used = store.sumAttemptTokenUsage({ taskId: task.taskId })
  if (used < limit) {
    return false
  }
  missions.transitionTaskStage({
    taskId: task.taskId,
    to: 'BLOCKED',
    reason: 'token_budget_exhausted',
    actor: 'Scheduler'
  })
  store.appendAuditEvent({
    missionId: task.missionId,
    actor: 'Scheduler',
    objectKind: 'task',
    objectId: task.taskId,
    event: 'budget.exhausted',
    before: null,
    after: { dimension: 'maxTokens', limit, used },
    createdAt: now()
  })
  return true
}
