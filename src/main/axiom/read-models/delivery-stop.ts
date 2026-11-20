import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import { DELIVERY_STOPPED_EVENT } from '../delivery/delivery-write'

const Stop = z.object({
  approvalId: z.string(),
  targetBranch: z.string(),
  reason: z.enum([
    'target_checked_out',
    'remote_configured',
    'signature_verification_required',
    'integration_head_unexpected'
  ]),
  worktreePath: z.string().optional()
})

export function deliveryStop(
  store: AxiomStore,
  missionId: string,
  approvalId: string,
  grantedSequence: number
) {
  const event = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'mission',
    objectId: missionId,
    events: [DELIVERY_STOPPED_EVENT]
  })
  const stop = Stop.safeParse(event?.after)
  if (
    !event ||
    event.sequence <= grantedSequence ||
    !stop.success ||
    stop.data.approvalId !== approvalId
  ) {
    return undefined
  }
  const { targetBranch, worktreePath, reason } = stop.data
  const summaries = {
    target_checked_out: `Target branch ${targetBranch} is checked out at ${worktreePath}. Free the branch there before delivering again with the same approval.`,
    remote_configured: `Target branch ${targetBranch}: this repository has a remote; delivery by pull request is not available yet.`,
    signature_verification_required: `Target branch ${targetBranch}: this repository demands verified signatures for merges; the integration commits are unsigned.`,
    integration_head_unexpected: `Target branch ${targetBranch}: the integration branch is not at its recorded commit.`
  }
  return { reason: 'delivery_stopped', since: event.createdAt, summary: summaries[reason] }
}
