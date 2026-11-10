import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { ControllerContext } from '../mission-controller/controller-context'
import type { AxiomStore } from '../db/axiom-store'

export function interruptionBackoff(store: AxiomStore, taskId: string, now: string): boolean {
  const effect = store.getEffect(
    'attempt.continue',
    `${taskId}/${store.nextAttemptSeq(taskId) - 1}`
  )
  return effect?.status === 'pending' && Date.parse(effect.dueAt) > Date.parse(now)
}

export function blockingQuestionOrApproval(
  ctx: Pick<ControllerContext, 'db' | 'store'>,
  task: TaskStageRecord
): 'none' | 'question' | 'approval' {
  if (
    ctx.db.listGates({ taskId: task.taskId, status: 'pending' }).length > 0 ||
    ctx.store.hasPendingQuestionForTask(task.taskId) ||
    ctx.store.hasPendingTypedQuestionForTask(task.taskId)
  ) {
    return 'question'
  }
  return ctx.store.hasBlockingApproval(task.missionId) ? 'approval' : 'none'
}
