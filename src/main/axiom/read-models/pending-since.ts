import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { BudgetExhaustion } from '../scheduler/admission-budget'
import { utcTimestamp, type WaitingContext } from './waiting-context'

export function budgetSince(
  ctx: WaitingContext,
  budget: BudgetExhaustion,
  fallback: string,
  taskId?: string
): string {
  if (budget.dimension === 'maxWallClockMinutes') {
    return new Date(
      Date.parse(ctx.now) - Math.round((budget.used - budget.limit) * 60_000)
    ).toISOString()
  }
  if (budget.dimension === 'maxTokens') {
    // ponytail: the current ledger has no crossing history; use its latest supporting measurement.
    const measured = ctx.store
      .listAttemptTokenUsage({ missionId: ctx.mission.id, ...(taskId ? { taskId } : {}) })
      .filter((row) => row.newTokens > 0)
      .map((row) => utcTimestamp(row.measuredAt))
      .sort()
    return measured.at(-1) ?? fallback
  }
  // ponytail: refunded Attempts and later cap edits prevent reconstructing the crossing from bindings alone.
  const admitted = ctx.bindings
    .filter((binding) => taskId === undefined || binding.taskId === taskId)
    .map((binding) => utcTimestamp(binding.createdAt))
    .sort()
  return admitted.at(-1) ?? fallback
}

export function missionSince(
  ctx: WaitingContext,
  statusAudit: AuditEvent | undefined,
  exhaustedAudit: AuditEvent | undefined
): string {
  if (exhaustedAudit) {
    return exhaustedAudit.createdAt
  }
  let since = statusAudit?.createdAt ?? ctx.mission.updatedAt
  if (ctx.mission.status === 'ANALYZING') {
    const ending = ctx.store.getLatestReadModelAudit({
      missionId: ctx.mission.id,
      objectKind: 'attempt',
      events: [
        'planner.launch_failed',
        'planner.attempt_failed',
        'planner.stopped',
        'planner.abandoned'
      ]
    })
    if (ending && ending.sequence > (statusAudit?.sequence ?? 0)) {
      since = ending.createdAt
    }
  }
  if (ctx.missionBudget) {
    const exhaustedAt = budgetSince(ctx, ctx.missionBudget, since)
    return [utcTimestamp(since), utcTimestamp(exhaustedAt)].sort().at(-1) ?? since
  }
  return since
}
