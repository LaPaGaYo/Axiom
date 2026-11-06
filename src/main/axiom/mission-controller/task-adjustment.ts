import type { z } from 'zod'
import type { TaskSpec } from '../../../shared/axiom-contract/mission-objects'
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
import { activeCandidateVerification } from '../verification/verification-candidate'
import { validateTaskAcceptance } from '../../../shared/axiom-contract/plan-proposal'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { validateTaskCommands } from './plan-materialization'
import { redactContext } from '../context-builder/redaction'

function acceptanceForAudit(criteria: TaskSpec['acceptanceCriteria']) {
  return criteria.map((criterion) =>
    typeof criterion === 'string'
      ? redactContext(criterion).content
      : {
          ...criterion,
          text: redactContext(criterion.text).content,
          check:
            criterion.check.kind === 'command'
              ? { ...criterion.check, command: redactContext(criterion.check.command).content }
              : criterion.check
        }
  )
}

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
  const { candidate, latest } = activeCandidateVerification(ctx.store, task)
  if (
    (!['DEFINED', 'READY', 'NEEDS_FIX', 'BLOCKED'].includes(task.stage) &&
      !(task.stage === 'VERIFYING' && latest?.status === 'HUMAN_REVIEW')) ||
    (p.acceptanceCriteria && (latest?.status === 'QUEUED' || latest?.status === 'RUNNING'))
  ) {
    throw new MissionControllerError('illegal_transition', {
      taskId: task.taskId,
      from: task.stage,
      reason: 'task_not_adjustable'
    })
  }
  if (redactContext(p.rationale).redacted) {
    throw new OrchestrationError('invalid_argument', 'secret_in_rationale')
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
  if (p.acceptanceCriteria) {
    spec.acceptanceCriteria = p.acceptanceCriteria
    const parsedRules = VerificationRulesSchema.safeParse(
      ctx.store.getPolicy(mission.id)?.verificationRules
    )
    const rules = parsedRules.success ? parsedRules.data : VerificationRulesSchema.parse({})
    const errors = [
      ...validateTaskAcceptance(spec, ['task']),
      ...validateTaskCommands(spec, rules, ['task'])
    ]
    if (errors.length) {
      throw new MissionControllerError('plan_invalid', { errors })
    }
  }
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
      maxAttempts: task.retryPolicy.maxAttempts,
      ...(p.acceptanceCriteria
        ? { acceptanceCriteria: acceptanceForAudit(task.spec.acceptanceCriteria) }
        : {})
    },
    after: {
      allowedPaths,
      maxAttempts,
      addedPaths,
      rationale: p.rationale,
      afterAttemptSeq: ctx.store.nextAttemptSeq(task.taskId) - 1,
      origin: 'user',
      resolvedMessageIds,
      ...(p.acceptanceCriteria
        ? { acceptanceCriteria: acceptanceForAudit(p.acceptanceCriteria) }
        : {})
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
  // Criteria-only corrections keep the immutable Candidate available for an explicit rerun.
  if (
    adjusted.stage === 'BLOCKED' &&
    candidate &&
    p.acceptanceCriteria &&
    !p.addAllowedPaths.length &&
    p.maxAttempts === undefined
  ) {
    return projectTask(ctx, adjusted)
  }
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
