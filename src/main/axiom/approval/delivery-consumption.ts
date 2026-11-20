import { audit, type ControllerContext } from '../mission-controller/controller-context'
import type { current } from './delivery-check'

export function consume(
  ctx: ControllerContext,
  checked: ReturnType<typeof current>,
  outcome: 'fast_forwarded' | 'up_to_date',
  via: string
) {
  const { approval, record } = checked
  const executedAt = ctx.now()
  if (!ctx.store.consumeApproval({ id: approval.id, outcome, executedAt })) {
    return undefined
  }
  audit(ctx, {
    missionId: approval.missionId,
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.consumed',
    before: { status: approval.status },
    after: {
      id: approval.id,
      inputsHash: approval.inputsHash,
      outcome,
      executedAt,
      targetBranch: record.targetBranch,
      from: record.targetHead ?? null,
      to: record.integrationHead ?? null,
      via
    }
  })
  return ctx.store.getApproval(approval.id)
}
