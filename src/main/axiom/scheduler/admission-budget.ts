import { z } from 'zod'
import type { Policy } from '../../../shared/axiom-contract/mission-objects'
import type { AxiomStore } from '../db/axiom-store'

export type BudgetExhaustion = {
  dimension: 'maxAttempts' | 'maxWallClockMinutes'
  limit: number
  used: number
}
const StatusSnapshot = z.object({ status: z.string() })

export function budgetExhaustion(
  store: AxiomStore,
  missionId: string,
  policy: Policy,
  now: () => string
): BudgetExhaustion | undefined {
  const attempts = store.listTaskStages({ missionId }).reduce((sum, t) => sum + t.attemptCount, 0)
  if (policy.budget.maxAttempts !== undefined && attempts >= policy.budget.maxAttempts) {
    return { dimension: 'maxAttempts', limit: policy.budget.maxAttempts, used: attempts }
  }
  const limit = policy.budget.maxWallClockMinutes
  if (limit !== undefined) {
    const start = store
      .listAuditEvents({ missionId })
      .find(
        (event) =>
          event.event === 'mission.status' &&
          StatusSnapshot.safeParse(event.after).data?.status === 'EXECUTING'
      )
    if (!start) {
      throw new Error('mission_execution_start_missing')
    }
    const startedAt = start.createdAt.includes('T')
      ? start.createdAt
      : `${start.createdAt.replace(' ', 'T')}Z`
    const used = (Date.parse(now()) - Date.parse(startedAt)) / 60_000
    if (!Number.isFinite(used)) {
      throw new Error('mission_execution_time_invalid')
    }
    if (used >= limit) {
      return { dimension: 'maxWallClockMinutes', limit, used }
    }
  }
  return undefined
}
