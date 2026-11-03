import type { z } from 'zod'
import { TaskAdjustParams } from '../../../shared/axiom-contract/task-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  audit,
  MissionControllerError,
  requireMission,
  requireTask,
  type ControllerContext
} from './controller-context'
import { projectTask, transitionTaskStage } from './task-readiness'

export function resolveBlockedMessages(
  ctx: ControllerContext,
  input: {
    taskId: string
    missionId: string
    actor: string
    rationale: string
    decision: 'adjusted' | 'canceled'
  }
) {
  const messages = ctx.store.listMessages({
    missionId: input.missionId,
    taskId: input.taskId,
    type: 'BLOCKED',
    pendingOnly: true
  })
  for (const message of messages) {
    audit(ctx, {
      missionId: input.missionId,
      actor: input.actor,
      objectKind: 'message',
      objectId: message.id,
      event: 'blocked.resolved',
      before: null,
      after: { decision: input.decision, taskId: input.taskId, rationale: input.rationale }
    })
  }
  return messages.map((message) => message.id)
}

export function adjustTask(
  ctx: ControllerContext,
  input: z.input<typeof TaskAdjustParams> & { actor: string }
) {
  const { actor, ...params } = input
  const p = TaskAdjustParams.parse(params)
  const task = requireTask(ctx, p.taskId)
  const mission = requireMission(ctx, task.missionId)
  if (mission.status !== 'PLANNED' && mission.status !== 'EXECUTING') {
    throw new MissionControllerError('mission_not_executing', { missionId: mission.id })
  }
  const plan = mission.activePlanRevisionId
    ? ctx.store.getPlanRevision(mission.activePlanRevisionId)
    : undefined
  if (
    !plan ||
    plan.status !== 'APPROVED' ||
    plan.missionId !== mission.id ||
    task.planRevisionId !== plan.id
  ) {
    throw new MissionControllerError('plan_pending', { missionId: mission.id })
  }
  if (!['DEFINED', 'READY', 'NEEDS_FIX', 'BLOCKED'].includes(task.stage)) {
    throw new MissionControllerError('illegal_transition', {
      taskId: task.taskId,
      from: task.stage,
      reason: 'task_not_adjustable'
    })
  }
  const maxAttempts = p.maxAttempts ?? task.retryPolicy.maxAttempts
  if (maxAttempts < task.attemptCount) {
    throw new OrchestrationError(
      'invalid_argument',
      'maxAttempts cannot be below the consumed Attempt count.',
      {
        taskId: task.taskId,
        attemptCount: task.attemptCount,
        maxAttempts
      }
    )
  }
  const allowedPaths = [...new Set([...task.spec.scope.allowedPaths, ...p.addAllowedPaths])]
  const addedPaths = allowedPaths.filter((path) => !task.spec.scope.allowedPaths.includes(path))
  const retryPolicy = { ...task.retryPolicy, maxAttempts }
  const spec = { ...task.spec, scope: { ...task.spec.scope, allowedPaths }, retryPolicy }
  if (
    !ctx.store.updateTaskSpec({ taskId: task.taskId, expectedStage: task.stage, spec, retryPolicy })
  ) {
    throw new MissionControllerError('stale_state', { taskId: task.taskId, from: task.stage })
  }
  const resolvedMessageIds = resolveBlockedMessages(ctx, {
    missionId: mission.id,
    taskId: task.taskId,
    actor,
    rationale: p.rationale,
    decision: 'adjusted'
  })
  audit(ctx, {
    missionId: mission.id,
    actor,
    objectKind: 'task',
    objectId: task.taskId,
    event: 'task.adjusted',
    before: {
      allowedPaths: task.spec.scope.allowedPaths,
      maxAttempts: task.retryPolicy.maxAttempts
    },
    after: {
      allowedPaths,
      maxAttempts,
      addedPaths,
      rationale: p.rationale,
      afterAttemptSeq: ctx.store.nextAttemptSeq(task.taskId) - 1,
      origin: 'user',
      resolvedMessageIds
    }
  })
  audit(ctx, {
    missionId: mission.id,
    actor,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.minor_adjustment',
    before: null,
    after: {
      classification: 'MINOR_ADJUSTMENT',
      origin: 'task_adjust',
      taskId: task.taskId,
      addedPaths,
      maxAttempts,
      rationale: p.rationale
    }
  })
  let adjusted = requireTask(ctx, task.taskId)
  if (adjusted.stage === 'BLOCKED') {
    if (!adjusted.previousStage) {
      throw new MissionControllerError('illegal_transition', {
        taskId: task.taskId,
        from: 'BLOCKED',
        reason: 'previous_stage_missing'
      })
    }
    adjusted = transitionTaskStage(ctx, {
      taskId: task.taskId,
      to: adjusted.previousStage,
      reason: 'adjusted',
      actor
    })
  }
  if (adjusted.stage === 'NEEDS_FIX') {
    if (adjusted.attemptCount >= maxAttempts) {
      throw new MissionControllerError('retry_budget_exhausted', {
        taskId: task.taskId,
        attemptCount: adjusted.attemptCount,
        maxAttempts
      })
    }
    adjusted = transitionTaskStage(ctx, {
      taskId: task.taskId,
      to: 'READY',
      reason: 'adjusted',
      actor
    })
  }
  return projectTask(ctx, adjusted)
}
