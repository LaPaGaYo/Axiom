import { z } from 'zod'
import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type { TaskWaitingOn, WaitingBudget } from '../../../shared/axiom-contract/task-waiting-on'
import { TERMINAL_TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'
import { auditReason, utcTimestamp, type WaitingContext } from './waiting-context'

export const BEFORE_ADMISSION = new Set(['DEFINED', 'READY', 'NEEDS_FIX'])
export const QUESTION_BLOCKING_STAGES = new Set([...BEFORE_ADMISSION, 'RUNNING', 'BLOCKED'])
const humanMissionStatuses = new Set(['PLAN_REVIEW', 'PLANNED', 'PAUSED', 'BLOCKED'])
const reviewStatuses = new Set(['HUMAN_REVIEW', 'SPECIALIST_REVIEW', 'INCONCLUSIVE'])
const Cooldowns = z.object({
  accountCooldown: z.array(z.object({ until: z.string() })).default([])
})

function taskBudget(
  ctx: WaitingContext,
  task: TaskStageRecord,
  dimension: 'maxTokens' | 'maxAttempts'
) {
  const limit =
    dimension === 'maxTokens' ? task.spec.budget?.maxTokens : task.retryPolicy.maxAttempts
  if (limit === undefined) {
    return undefined
  }
  const used =
    dimension === 'maxTokens'
      ? ctx.store.sumAttemptTokenUsage({ taskId: task.taskId })
      : task.attemptCount
  return { scope: 'task' as const, dimension, limit, used }
}

function waitingBudget(reason: string, budget?: WaitingBudget): TaskWaitingOn {
  return { on: 'budget', reason, person: true, ...(budget ? { budget } : {}) }
}

function admissionWait(ctx: WaitingContext, task: TaskStageRecord): TaskWaitingOn {
  const seq = ctx.latestBindings.get(task.taskId)?.seq ?? 0
  const effect = ctx.store.getEffect('attempt.continue', `${task.taskId}/${seq}`)
  if (effect?.status === 'pending' && Date.parse(effect.dueAt) > Date.parse(ctx.now)) {
    return { on: 'admission', reason: 'backoff', person: false, until: utcTimestamp(effect.dueAt) }
  }
  if (task.stage === 'READY') {
    if (ctx.runningCount >= ctx.policy.concurrencyLimit) {
      return { on: 'admission', reason: 'concurrency', person: false }
    }
    const refusal = ctx.store.getLatestReadModelAudit({
      missionId: task.missionId,
      objectKind: 'task',
      objectId: task.taskId,
      events: ['task.admission_refused']
    })
    if (refusal && refusal.sequence > (ctx.stageAudit(task)?.sequence ?? 0)) {
      const cooldowns = Cooldowns.safeParse(refusal.after).data?.accountCooldown ?? []
      const until = cooldowns.map((cooldown) => utcTimestamp(cooldown.until)).sort()[0]
      return {
        on: 'admission',
        reason: 'no_eligible_provider',
        person: cooldowns.length === 0,
        ...(until ? { until } : {})
      }
    }
  }
  return { on: 'admission', reason: 'next_round', person: false }
}

// Glossary §4.4a is the canonical first-match order. No admission is attempted by this read.
export function taskWaitingOn(ctx: WaitingContext, task: TaskStageRecord): TaskWaitingOn {
  if (TERMINAL_TASK_STAGES.has(task.stage)) {
    return {
      on: 'none',
      reason: task.stage === 'INTEGRATED' ? 'integrated' : 'canceled',
      person: false
    }
  }
  const beforeAdmission = BEFORE_ADMISSION.has(task.stage)
  const plan = ctx.plansById.get(task.planRevisionId)
  if (beforeAdmission && (ctx.mission.status !== 'EXECUTING' || plan?.status !== 'APPROVED')) {
    return {
      on: 'mission',
      reason: ctx.mission.status !== 'EXECUTING' ? ctx.mission.status : 'plan_not_approved',
      person: humanMissionStatuses.has(ctx.mission.status),
      missionStatus: ctx.mission.status
    }
  }
  if (beforeAdmission) {
    const taskIds = (ctx.upstream.get(task.taskId) ?? []).filter(
      (id) => ctx.tasksById.get(id)?.stage !== 'INTEGRATED'
    )
    if (taskIds.length) {
      const canceled = taskIds.some((id) => ctx.tasksById.get(id)?.stage === 'CANCELED')
      return {
        on: 'dependency',
        reason: canceled ? 'upstream_canceled' : 'upstream_not_integrated',
        person: canceled,
        taskIds
      }
    }
  }
  if (
    QUESTION_BLOCKING_STAGES.has(task.stage) &&
    (ctx.db.listGates({ taskId: task.taskId, status: 'pending' }).length > 0 ||
      ctx.store.hasPendingQuestionForTask(task.taskId) ||
      ctx.store.hasPendingTypedQuestionForTask(task.taskId))
  ) {
    return { on: 'question', reason: 'question', person: true }
  }
  if (beforeAdmission && ctx.blockingApproval) {
    return { on: 'approval', reason: 'approval', person: true }
  }
  const blockReason = task.stage === 'BLOCKED' ? auditReason(ctx.stageAudit(task)) : undefined
  if (blockReason === 'retry_budget_exhausted' || blockReason === 'token_budget_exhausted') {
    return waitingBudget(
      blockReason,
      taskBudget(ctx, task, blockReason === 'retry_budget_exhausted' ? 'maxAttempts' : 'maxTokens')
    )
  }
  if (beforeAdmission) {
    if (ctx.missionBudget) {
      return waitingBudget('budget_exhausted', { scope: 'mission', ...ctx.missionBudget })
    }
    const tokens = taskBudget(ctx, task, 'maxTokens')
    if (tokens && tokens.used >= tokens.limit) {
      return waitingBudget('task_tokens', tokens)
    }
    if (task.attemptCount >= task.retryPolicy.maxAttempts) {
      return waitingBudget('task_attempts', taskBudget(ctx, task, 'maxAttempts'))
    }
    return admissionWait(ctx, task)
  }
  if (task.stage === 'SUBMITTED' || task.stage === 'VERIFYING') {
    const { latest } = ctx.verification(task.taskId)
    const runId = latest ? { runId: latest.id } : {}
    if (task.stage === 'VERIFYING' && latest && reviewStatuses.has(latest.status)) {
      return {
        on: 'human',
        reason:
          typeof latest.verdictDetail.reason === 'string'
            ? latest.verdictDetail.reason
            : 'human_review',
        person: true,
        ...runId
      }
    }
    return { on: 'verification', reason: latest?.status ?? 'QUEUED', person: false, ...runId }
  }
  if (task.stage === 'VERIFIED' || task.stage === 'INTEGRATION_READY') {
    return { on: 'integration', reason: 'integration_queue', person: false }
  }
  if (task.stage === 'BLOCKED') {
    return { on: 'human', reason: blockReason ?? 'blocked', person: true }
  }
  const seq = ctx.latestBindings.get(task.taskId)?.seq
  return { on: 'running', reason: 'attempt_running', person: false, ...(seq ? { seq } : {}) }
}
