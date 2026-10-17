import { z } from 'zod'
import { parseAxiomMessagePayload } from '../../../shared/axiom-contract/message-params'
import type { TaskSpec } from '../../../shared/axiom-contract/mission-objects'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import { checkSubtask } from './subtask-checks'

type Context = { db: OrchestrationDb; store: AxiomStore; missions: MissionController }
export function resolveSubtask(
  ctx: Context,
  p: {
    missionId: string
    messageId: string
    decision: 'accept' | 'reject' | 'auto_accept'
    rationale: string
  }
) {
  const { db, store, missions } = ctx
  return store.transaction('subtask_resolution', () => {
    const mission = missions.getMission(p.missionId)
    const message = db.getMessageById(p.messageId)
    const axiom = message && parseAxiomMessagePayload(message.payload)?.axiom
    const resolved = store
      .listAuditEvents({ missionId: mission.id })
      .some(
        (e) =>
          e.event === 'subtask.resolved' && e.objectKind === 'message' && e.objectId === p.messageId
      )
    if (
      !message ||
      message.run_id !== mission.runId ||
      message.to_handle !== `run:${mission.runId}` ||
      axiom?.missionId !== mission.id ||
      axiom.type !== 'REQUEST_SUBTASK' ||
      !axiom.subtask ||
      resolved
    ) {
      throw new OrchestrationError(
        'invalid_argument',
        'Message is not a pending subtask request in this Mission.'
      )
    }
    const audit = {
      missionId: mission.id,
      actor: p.decision === 'auto_accept' ? 'MissionController' : 'user',
      objectKind: 'message',
      objectId: p.messageId,
      before: null
    }
    let taskId: string | undefined
    if (p.decision !== 'reject') {
      const parent = store.getTaskStage(axiom.taskId)
      if (!parent) {
        throw new OrchestrationError('invalid_argument', 'Requesting Task was not found.')
      }
      const { allowedPaths, dependsOn = [], ...body } = axiom.subtask
      const task: TaskSpec = {
        ...body,
        id: `subtask:${message.id}`,
        scope: { allowedPaths },
        retryPolicy: parent.retryPolicy,
        kind: 'task',
        ...(parent.spec.milestoneId ? { milestoneId: parent.spec.milestoneId } : {})
      }
      const source = { taskId: axiom.taskId, attemptId: axiom.attemptId, messageId: message.id }
      const dependencies = [...new Set([axiom.taskId, ...dependsOn])]
      const checks = checkSubtask(ctx, {
        missionId: mission.id,
        task,
        dependsOn: dependencies,
        source
      })
      if (!checks.ok) {
        store.appendAuditEvent({
          ...audit,
          event: 'subtask.checks_failed',
          after: { failed: checks.failed }
        })
        return { resolved: false as const, failed: checks.failed }
      }
      if (p.decision === 'auto_accept') {
        const enabled = z
          .boolean()
          .optional()
          .safeParse(store.getPolicy(mission.id)?.approvalRules.subtaskAutoCreate)
        if (!enabled.success || enabled.data !== true) {
          return { resolved: false as const, failed: [] }
        }
      }
      taskId = missions.createTask(
        {
          missionId: mission.id,
          task,
          dependsOn: dependencies,
          provenance: { kind: 'model', actor: axiom.attemptId, at: new Date().toISOString() }
        },
        source
      ).taskId
    }
    const result = { decision: p.decision, reason: p.rationale, ...(taskId ? { taskId } : {}) }
    store.appendAuditEvent({ ...audit, event: 'subtask.resolved', after: result })
    return { resolved: true as const, ...result }
  })
}

export function processSubtaskRequest(ctx: Context, missionId: string, messageId: string) {
  if (
    ctx.store
      .listAuditEvents({ missionId })
      .some(
        (e) =>
          e.event === 'subtask.resolved' && e.objectKind === 'message' && e.objectId === messageId
      )
  ) {
    return
  }
  resolveSubtask(ctx, {
    missionId,
    messageId,
    decision: 'auto_accept',
    rationale: 'D50 checks passed and subtaskAutoCreate enabled'
  })
}
