import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { TaskCreateParams } from '../../../shared/axiom-contract/task-params'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  audit,
  requireMission,
  MissionControllerError,
  type ControllerContext
} from './controller-context'
import { checkSubtask, type SubtaskSource } from '../messaging/subtask-checks'
import { projectTask, recomputeReadiness } from './task-readiness'
import { validateTaskAcceptance } from '../../../shared/axiom-contract/plan-proposal'
import { VerificationRulesSchema } from '../../../shared/axiom-contract/verification-rules'
import { validateTaskCommands } from './plan-validation'
import { validateGoalCoverage } from '../../../shared/axiom-contract/plan-coverage'

export function createTask(
  ctx: ControllerContext,
  input: z.input<typeof TaskCreateParams>,
  source?: SubtaskSource
) {
  const p = TaskCreateParams.parse(input)
  const mission = requireMission(ctx, p.missionId)
  if (mission.status !== 'PLANNED' && mission.status !== 'EXECUTING') {
    throw new MissionControllerError('mission_not_executing', { missionId: mission.id })
  }
  const plan = mission.activePlanRevisionId
    ? ctx.store.getPlanRevision(mission.activePlanRevisionId)
    : undefined
  if (!plan || plan.status !== 'APPROVED' || plan.missionId !== mission.id) {
    throw new MissionControllerError('plan_pending', { missionId: mission.id })
  }
  const spec = { ...p.task, id: randomUUID() }
  const acceptanceErrors = validateTaskAcceptance(spec, ['task'])
  if (acceptanceErrors.length) {
    throw new MissionControllerError('plan_invalid', { errors: acceptanceErrors })
  }
  const parsedRules = VerificationRulesSchema.safeParse(
    ctx.store.getPolicy(mission.id)?.verificationRules
  )
  const rules = parsedRules.success ? parsedRules.data : VerificationRulesSchema.parse({})
  const commandErrors = validateTaskCommands(spec, rules, ['task'])
  if (commandErrors.length) {
    throw new MissionControllerError('plan_invalid', { errors: commandErrors })
  }
  const goal = mission.activeGoalRevisionId
    ? ctx.store.getGoalRevision(mission.activeGoalRevisionId)
    : undefined
  if (!goal || goal.missionId !== mission.id || goal.status !== 'ACTIVE') {
    throw new MissionControllerError('goal_revision_not_found', { missionId: mission.id })
  }
  const coverageErrors = validateGoalCoverage(spec, goal.acceptanceCriteria.length, ['task'])
  if (coverageErrors.length) {
    throw new MissionControllerError('plan_invalid', { errors: coverageErrors })
  }
  const dependsOn = [...new Set([...(source ? [source.taskId] : []), ...p.dependsOn])]
  const checks = checkSubtask(ctx, { missionId: mission.id, task: spec, dependsOn, source })
  if (!checks.ok) {
    throw new OrchestrationError('invalid_argument', 'Task creation checks failed.', {
      failed: checks.failed
    })
  }
  const task = ctx.db.createTask({
    spec: JSON.stringify(spec),
    taskTitle: spec.title,
    runId: mission.runId,
    deps: []
  })
  const record = {
    taskId: task.id,
    missionId: mission.id,
    planRevisionId: plan.id,
    stage: 'DEFINED' as const,
    previousStage: null,
    spec,
    retryPolicy: spec.retryPolicy,
    attemptCount: 0
  }
  ctx.store.insertTaskStage(record)
  const edges = dependsOn.map((fromTaskId) => ({
    fromTaskId,
    toTaskId: task.id,
    readinessThreshold: ctx.store.getPolicy(mission.id)!.readinessThreshold
  }))
  ctx.store.insertTaskEdges(mission.id, plan.id, edges)
  const origin = source ? 'request_subtask' : 'user'
  const actor = source ? 'MissionController' : p.provenance.actor
  const context = {
    origin,
    ...(source ? { messageId: source.messageId } : {}),
    provenance: p.provenance
  }
  audit(ctx, {
    missionId: mission.id,
    actor,
    objectKind: 'task',
    objectId: task.id,
    event: 'task.created',
    before: null,
    after: { ...record, ...context }
  })
  audit(ctx, {
    missionId: mission.id,
    actor,
    objectKind: 'plan_revision',
    objectId: plan.id,
    event: 'plan.minor_adjustment',
    before: null,
    after: { classification: 'MINOR_ADJUSTMENT', ...context, taskId: task.id, edges }
  })
  recomputeReadiness(ctx, mission.id)
  return projectTask(ctx, ctx.store.getTaskStage(task.id)!)
}
