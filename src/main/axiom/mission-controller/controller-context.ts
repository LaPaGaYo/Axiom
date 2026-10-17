import type { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AuditEventSchema } from '../../../shared/axiom-contract/mission-objects'

export const MISSION_CONTROLLER_ERROR_CODES = [
  'mission_not_found',
  'goal_revision_not_found',
  'goal_not_proposed',
  'plan_revision_not_found',
  'task_not_found',
  'illegal_transition',
  'stale_state',
  'plan_invalid',
  'plan_pending',
  'plan_not_proposed',
  'replan_not_supported',
  'mission_not_executing',
  'synthetic_session_id_invalid'
] as const

export class MissionControllerError extends Error {
  constructor(
    readonly code: (typeof MISSION_CONTROLLER_ERROR_CODES)[number],
    readonly data: Record<string, unknown>
  ) {
    super(code)
    this.name = 'MissionControllerError'
  }
}

export type ControllerContext = {
  db: OrchestrationDb
  store: AxiomStore
  now: () => string
  mintSessionId: () => string
}

export function requireMission(ctx: ControllerContext, id: string) {
  const mission = ctx.store.getMission(id)
  if (!mission) {
    throw new MissionControllerError('mission_not_found', { missionId: id })
  }
  return mission
}

export function requirePlan(ctx: ControllerContext, id: string) {
  const plan = ctx.store.getPlanRevision(id)
  if (!plan) {
    throw new MissionControllerError('plan_revision_not_found', { planRevisionId: id })
  }
  return plan
}

export function requireTask(ctx: ControllerContext, id: string) {
  const task = ctx.store.getTaskStage(id)
  if (!task) {
    throw new MissionControllerError('task_not_found', { taskId: id })
  }
  return task
}

export function audit(
  ctx: ControllerContext,
  event: Omit<z.input<typeof AuditEventSchema>, 'sequence' | 'createdAt'>
) {
  // Persist JSON snapshots: optional domain fields with undefined values are absent.
  const before = AuditEventSchema.shape.before.parse(JSON.parse(JSON.stringify(event.before)))
  const after = AuditEventSchema.shape.after.parse(JSON.parse(JSON.stringify(event.after)))
  ctx.store.appendAuditEvent({ ...event, before, after, createdAt: ctx.now() })
}
