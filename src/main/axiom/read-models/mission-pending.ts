import type { z } from 'zod'
import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import {
  MissionPendingParams,
  type MissionPendingItem,
  type MissionPendingResponse,
  type PendingAction
} from '../../../shared/axiom-contract/mission-pending'
import { WaitingBudgetSchema } from '../../../shared/axiom-contract/task-waiting-on'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { getAxiomControlPlane } from '../control-plane'
import { hasActivePlannerAttempt } from '../execution/active-planner-attempt'
import { listStallNotifications } from '../supervision/stall-notifications'
import { auditReason, createWaitingContext, type WaitingContext } from './waiting-context'
import { comparePendingItems, createPendingItems, type PendingItems } from './pending-items'
import { pendingTaskItems } from './pending-task-items'
import { missionSince } from './pending-since'

function missionItem(ctx: WaitingContext, pending: PendingItems): MissionPendingItem[] {
  const { mission, store } = ctx
  const analyzing =
    mission.status === 'ANALYZING' &&
    !ctx.plans.some((plan) => plan.status === 'PROPOSED') &&
    !hasActivePlannerAttempt(store, ctx.db, mission.id)
  if (
    !['PLANNED', 'PAUSED', 'BLOCKED'].includes(mission.status) &&
    !analyzing &&
    !(mission.status === 'EXECUTING' && ctx.missionBudget)
  ) {
    return []
  }
  const statusAudit = store.getLatestReadModelAudit({
    missionId: mission.id,
    objectKind: 'mission',
    objectId: mission.id,
    events: ['mission.status'],
    status: mission.status
  })
  const statusReason = auditReason(statusAudit)
  const exhaustedAudit =
    mission.status === 'BLOCKED' && statusReason === 'budget_exhausted'
      ? store.getLatestReadModelAudit({
          missionId: mission.id,
          objectKind: 'mission',
          objectId: mission.id,
          events: ['budget.exhausted']
        })
      : undefined
  const persistedBudget = WaitingBudgetSchema.omit({ scope: true }).safeParse(
    exhaustedAudit?.after
  ).data
  const budget = ctx.missionBudget ?? persistedBudget
  const reason = ctx.missionBudget ? 'budget_exhausted' : mission.status
  const actions: PendingAction[] = []
  if (mission.status === 'PLANNED') {
    actions.push('axiom.mission.start')
  }
  if (mission.status === 'PAUSED') {
    actions.push('axiom.mission.resume')
  }
  if (analyzing && !ctx.missionBudget) {
    actions.push('axiom.mission.plan')
  }
  actions.push('axiom.mission.cancel')
  return [
    pending.item({
      kind: 'mission',
      objectId: mission.id,
      reason,
      blocking: true,
      actions,
      since: missionSince(ctx, statusAudit, exhaustedAudit),
      ...(['PAUSED', 'BLOCKED'].includes(mission.status) && statusReason !== undefined
        ? { summary: statusReason }
        : {}),
      ...(budget
        ? {
            waitingOn: {
              on: 'budget',
              reason: 'budget_exhausted',
              person: true,
              budget: { scope: 'mission', ...budget }
            }
          }
        : {})
    })
  ]
}

export function missionPending(
  runtime: OrcaRuntimeService,
  input: z.input<typeof MissionPendingParams>,
  clock: () => string
): MissionPendingResponse {
  const { missionId } = MissionPendingParams.parse(input)
  const ctx = createWaitingContext(
    getAxiomControlPlane(runtime).store,
    runtime.getOrchestrationDb(),
    missionId,
    clock
  )
  if (TERMINAL_MISSION_STATUSES.has(ctx.mission.status)) {
    return { missionId, items: [] }
  }
  const pending = createPendingItems(ctx)
  const items = [...missionItem(ctx, pending), ...pendingTaskItems(ctx, pending)]
  for (const plan of ctx.plans) {
    if (plan.status !== 'PROPOSED') {
      continue
    }
    const proposed = ctx.store.getLatestReadModelAudit({
      missionId,
      objectKind: 'plan_revision',
      objectId: plan.id,
      events: ['plan.proposed']
    })
    items.push(
      pending.item({
        kind: 'plan_review',
        objectId: plan.id,
        reason: 'PLAN_REVIEW',
        blocking: true,
        actions:
          ctx.mission.status === 'PLAN_REVIEW' ? ['axiom.plan.approve', 'axiom.plan.reject'] : [],
        since: proposed?.createdAt ?? plan.provenance.at
      })
    )
  }
  const notices = new Map(
    listStallNotifications(ctx.db, missionId).map((notice) => [notice.attemptId, notice])
  )
  for (const notice of notices.values()) {
    items.push(
      pending.item({
        kind: 'stall_notice',
        objectId: notice.attemptId,
        taskId: notice.taskId,
        reason: 'stalled',
        blocking: false,
        actions: ['axiom.task.cancel'],
        since: notice.notifiedAt
      })
    )
  }
  const proposal = ctx.store.getOpenSupervisionProposal()
  if (proposal) {
    items.push(
      pending.item({
        kind: 'supervision_proposal',
        objectId: proposal.id,
        reason: 'stalled',
        blocking: false,
        actions: ['axiom.supervision.resolve'],
        since: proposal.createdAt
      })
    )
  }
  return { missionId, items: items.sort(comparePendingItems) }
}
