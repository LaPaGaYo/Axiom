import type { TaskStageRecord } from '../../../shared/axiom-contract/mission-objects'
import type {
  MissionPendingItem,
  PendingAction
} from '../../../shared/axiom-contract/mission-pending'
import type { TaskWaitingOn } from '../../../shared/axiom-contract/task-waiting-on'
import { QUESTION_BLOCKING_STAGES } from './task-waiting-on'
import { utcTimestamp, type WaitingContext } from './waiting-context'
import type { PendingItems } from './pending-items'
import { budgetSince } from './pending-since'

function taskActions(
  ctx: WaitingContext,
  task: TaskStageRecord,
  wait: TaskWaitingOn
): PendingAction[] {
  const { candidate, latest } = ctx.verification(task.taskId)
  const adjust =
    ['PLANNED', 'EXECUTING'].includes(ctx.mission.status) &&
    (['DEFINED', 'READY', 'NEEDS_FIX', 'BLOCKED'].includes(task.stage) ||
      (task.stage === 'VERIFYING' && latest?.status === 'HUMAN_REVIEW'))
  const rerun =
    candidate &&
    (task.stage === 'BLOCKED' ||
      (task.stage === 'VERIFYING' && latest?.status === 'HUMAN_REVIEW')) &&
    latest?.status !== 'QUEUED' &&
    latest?.status !== 'RUNNING'
  const actions: PendingAction[] = []
  if (wait.runId) {
    if (latest?.status === 'HUMAN_REVIEW') {
      actions.push('axiom.verification.resolve')
    }
    if (rerun) {
      actions.push('axiom.verification.rerun')
    }
    if (adjust) {
      actions.push('axiom.task.adjust')
    }
  } else {
    if (adjust && !['upstream_canceled', 'no_eligible_provider'].includes(wait.reason)) {
      actions.push('axiom.task.adjust')
    }
    if (rerun) {
      actions.push('axiom.verification.rerun')
    }
    if (wait.reason === 'no_eligible_provider') {
      actions.push('axiom.policy.update')
    }
  }
  actions.push('axiom.task.cancel')
  return actions
}

function taskSince(ctx: WaitingContext, task: TaskStageRecord, wait: TaskWaitingOn) {
  if (wait.runId) {
    return ctx.verification(task.taskId).latest?.updatedAt ?? task.updatedAt
  }
  if (wait.reason === 'no_eligible_provider') {
    return (
      ctx.store.getLatestReadModelAudit({
        missionId: task.missionId,
        objectKind: 'task',
        objectId: task.taskId,
        events: ['task.admission_refused']
      })?.createdAt ?? task.updatedAt
    )
  }
  if (wait.reason === 'upstream_canceled') {
    const canceledAt = (wait.taskIds ?? []).flatMap((id) => {
      const upstream = ctx.tasksById.get(id)
      return upstream?.stage === 'CANCELED'
        ? [utcTimestamp(ctx.stageAudit(upstream)?.createdAt ?? upstream.updatedAt)]
        : []
    })
    if (canceledAt.length) {
      return canceledAt.sort()[0]
    }
  }
  const since = ctx.stageAudit(task)?.createdAt ?? task.updatedAt
  if (wait.on === 'budget' && wait.budget && task.stage !== 'BLOCKED') {
    return budgetSince(ctx, wait.budget, since, task.taskId)
  }
  return since
}

export function pendingTaskItems(ctx: WaitingContext, pending: PendingItems): MissionPendingItem[] {
  const items: MissionPendingItem[] = []
  const messages = ctx.store.listMessages({ missionId: ctx.mission.id, pendingOnly: true })
  const blockedMessages = new Map(
    messages
      .filter((message) => message.type === 'BLOCKED')
      .map((message) => [message.taskId, message])
  )
  for (const task of ctx.tasks) {
    const wait = pending.waits.get(task.taskId)
    if (!wait?.person || !pending.nonTerminal.has(task.taskId)) {
      continue
    }
    const review = wait.on === 'human' && wait.runId !== undefined
    const blocked =
      (wait.on === 'budget' && wait.budget?.scope !== 'mission') ||
      (wait.on === 'human' && !wait.runId) ||
      wait.on === 'dependency' ||
      wait.on === 'admission'
    if (!review && !blocked) {
      continue
    }
    const summary = blockedMessages.get(task.taskId)?.summary
    items.push(
      pending.item({
        kind: review ? 'human_review' : 'task_blocked',
        objectId: wait.runId ?? task.taskId,
        taskId: task.taskId,
        reason: wait.reason,
        blocking: true,
        actions: taskActions(ctx, task, wait),
        since: taskSince(ctx, task, wait),
        ...(!review && summary !== undefined ? { summary } : {})
      })
    )
  }
  for (const message of messages) {
    const task = ctx.tasksById.get(message.taskId)
    if (message.type === 'QUESTION') {
      if (task && !pending.nonTerminal.has(task.taskId)) {
        continue
      }
      items.push(
        pending.item({
          kind: 'question',
          objectId: message.id,
          ...(task ? { taskId: task.taskId } : {}),
          reason: 'question',
          blocking: !task || QUESTION_BLOCKING_STAGES.has(task.stage),
          ...(message.question !== undefined ? { summary: message.question } : {}),
          actions: ['axiom.message.answer'],
          since: message.createdAt
        })
      )
    } else if (
      message.type === 'REQUEST_SUBTASK' ||
      (message.type === 'REQUEST' && message.followUp)
    ) {
      const subtask = message.type === 'REQUEST_SUBTASK'
      items.push(
        pending.item({
          kind: subtask ? 'subtask_request' : 'follow_up',
          objectId: message.id,
          ...(task ? { taskId: task.taskId } : {}),
          reason: subtask ? 'REQUEST_SUBTASK' : 'follow_up',
          summary: message.summary,
          blocking: false,
          actions: ['axiom.message.resolve'],
          since: message.createdAt
        })
      )
    }
  }
  return items
}
