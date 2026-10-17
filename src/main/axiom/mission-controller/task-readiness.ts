import { blockingQuestionOrApproval } from '../scheduler/admission-blockers'
import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import {
  isLegalTaskStageTransition,
  TERMINAL_TASK_STAGES,
  type TaskStage
} from '../../../shared/axiom-contract/lifecycle'
import {
  audit,
  MissionControllerError,
  requireMission,
  requireTask,
  type ControllerContext
} from './controller-context'

// ponytail: small graphs recompute per Task (O(tasks²) with an attempt cap);
// batch Mission budget/Plan reads under the write lock if larger graphs require it.
export function canBecomeReady(
  ctx: Pick<ControllerContext, 'db' | 'store'>,
  task: TaskStageRecord
): boolean {
  const mission = ctx.store.getMission(task.missionId)
  if (mission?.status !== 'EXECUTING') {
    return false
  }
  const plan = ctx.store.getPlanRevision(task.planRevisionId)
  if (plan?.status !== 'APPROVED' || plan.missionId !== mission.id) {
    return false
  }
  if (
    task.attemptCount >= task.retryPolicy.maxAttempts ||
    blockingQuestionOrApproval(ctx, task) !== 'none'
  ) {
    return false
  }
  const policy = ctx.store.getPolicy(mission.id)
  if (!policy) {
    return false
  }
  const maxAttempts = policy.budget.maxAttempts
  if (
    maxAttempts !== undefined &&
    ctx.store
      .listTaskStages({ missionId: mission.id })
      .reduce((sum, row) => sum + row.attemptCount, 0) >= maxAttempts
  ) {
    return false
  }
  return ctx.store.listUpstreamEdges(task.taskId).every((edge) => {
    const upstream = ctx.store.getTaskStage(edge.fromTaskId)
    if (
      !upstream ||
      upstream.missionId !== mission.id ||
      upstream.planRevisionId !== task.planRevisionId
    ) {
      return false
    }
    return (
      upstream.stage === 'INTEGRATED' ||
      (edge.readinessThreshold === 'VERIFIED' &&
        (upstream.stage === 'VERIFIED' || upstream.stage === 'INTEGRATION_READY'))
    )
  })
}

export type TransitionTaskInput = {
  taskId: string
  to: TaskStage
  reason: string
  actor: string
  attemptCountDelta?: number
}
export function transitionTaskStage(ctx: ControllerContext, input: TransitionTaskInput) {
  const task = requireTask(ctx, input.taskId)
  const from = task.stage
  const to = input.to
  if (to === 'RUNNING' && (input.actor !== 'Scheduler' || input.attemptCountDelta !== 1)) {
    throw new MissionControllerError('illegal_transition', {
      taskId: task.taskId,
      from,
      to,
      reason: 'admission_required'
    })
  }
  if (
    !isLegalTaskStageTransition(from, to) ||
    (from === 'BLOCKED' && to !== 'CANCELED' && to !== task.previousStage)
  ) {
    throw new MissionControllerError('illegal_transition', {
      taskId: task.taskId,
      from,
      to,
      previousStage: task.previousStage
    })
  }
  if (from === 'DEFINED' && to === 'READY' && !canBecomeReady(ctx, task)) {
    const mission = requireMission(ctx, task.missionId)
    throw new MissionControllerError(
      mission.status === 'EXECUTING' ? 'illegal_transition' : 'mission_not_executing',
      {
        missionId: mission.id,
        taskId: task.taskId,
        from,
        to,
        reason: 'Readiness requirements unmet'
      }
    )
  }
  if (to === 'CANCELED') {
    stopAttemptsForCancellation()
  }
  const previousStage = to === 'BLOCKED' ? from : null
  if (
    !ctx.store.updateTaskStage({
      taskId: task.taskId,
      from,
      to,
      previousStage,
      attemptCountDelta: input.attemptCountDelta
    })
  ) {
    throw new MissionControllerError('stale_state', { taskId: task.taskId, from, to })
  }
  audit(ctx, {
    missionId: task.missionId,
    actor: input.actor,
    objectKind: 'task',
    objectId: task.taskId,
    event: 'task.stage',
    before: { stage: from, previousStage: task.previousStage },
    after: { stage: to, previousStage, reason: input.reason }
  })
  return requireTask(ctx, task.taskId)
}

function stopAttemptsForCancellation(): void {
  // Explicit no-op: M1 cannot launch Attempts. M2 must stop/abandon active Attempts
  // through the Execution Kernel before permitting cancellation.
}

export function cancelMissionTasks(ctx: ControllerContext, missionId: string, reason: string) {
  for (const task of ctx.store.listTaskStages({ missionId })) {
    if (!TERMINAL_TASK_STAGES.has(task.stage)) {
      transitionTaskStage(ctx, {
        taskId: task.taskId,
        to: 'CANCELED',
        reason,
        actor: 'MissionController'
      })
    }
  }
}

export function recomputeReadiness(ctx: ControllerContext, missionId: string): string[] {
  if (requireMission(ctx, missionId).status !== 'EXECUTING') {
    return []
  }
  const moved: string[] = []
  // Store order is task_id, independent of insertion or proposal order.
  for (const task of ctx.store.listTaskStages({ missionId, stage: 'DEFINED' })) {
    if (!canBecomeReady(ctx, task)) {
      continue
    }
    transitionTaskStage(ctx, {
      taskId: task.taskId,
      to: 'READY',
      actor: 'MissionController',
      reason: 'readiness'
    })
    moved.push(task.taskId)
  }
  return moved
}

export function projectTask(ctx: ControllerContext, row: TaskStageRecord) {
  const mission = requireMission(ctx, row.missionId)
  const orca = ctx.db.getTask(row.taskId)
  if (!orca || orca.run_id !== mission.runId) {
    throw new MissionControllerError('task_not_found', {
      taskId: row.taskId,
      missionId: mission.id
    })
  }
  return { ...row, orcaStatus: orca.status, title: orca.task_title ?? row.spec.title }
}

export function listTasks(ctx: ControllerContext, input: { missionId: string; stage?: TaskStage }) {
  requireMission(ctx, input.missionId)
  return ctx.store.listTaskStages(input).map((row) => projectTask(ctx, row))
}
