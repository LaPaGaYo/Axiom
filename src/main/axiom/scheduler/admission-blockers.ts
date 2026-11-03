import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { ControllerContext } from '../mission-controller/controller-context'

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
