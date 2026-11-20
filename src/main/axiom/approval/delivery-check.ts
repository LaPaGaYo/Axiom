import {
  MissionControllerError,
  requireMission,
  type ControllerContext
} from '../mission-controller/controller-context'
import { missionFinalization } from '../read-models/finalization-reads'
import { latestDeliveryApproval, requestDeliveryApproval } from './delivery-approval'

export type DeliveryInput = { missionId: string; approvalId: string; via: string }

// Repeated inside every delivery write; expiry is checked only before reading git.
export function current(ctx: ControllerContext, input: Omit<DeliveryInput, 'via'>) {
  const mission = requireMission(ctx, input.missionId)
  const approval = ctx.store.getApproval(input.approvalId)
  if (!approval || approval.actionKind !== 'delivery' || approval.missionId !== mission.id) {
    throw new MissionControllerError('approval_not_found', { approvalId: input.approvalId })
  }
  if (approval.status !== 'GRANTED') {
    throw new MissionControllerError('approval_not_granted', {
      approvalId: approval.id,
      status: approval.status
    })
  }
  if (mission.status !== 'READY_FOR_APPROVAL') {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      command: 'deliver'
    })
  }
  const record = missionFinalization(ctx.store, mission.id)
  if (
    latestDeliveryApproval(ctx.store, mission.id)?.id !== approval.id ||
    record?.outcome !== 'ready' ||
    record.reportSha256 !== approval.inputsHash
  ) {
    throw new MissionControllerError('approval_stale', { approvalId: approval.id })
  }
  return { mission, approval, record }
}

export function check(ctx: ControllerContext, input: Omit<DeliveryInput, 'via'>) {
  const checked = current(ctx, input)
  const { approval } = checked
  const now = ctx.now()
  if (Date.parse(approval.expiresAt) > Date.parse(now)) {
    return { checked }
  }
  const replacement = requestDeliveryApproval(
    ctx.store,
    approval.missionId,
    approval.inputsHash,
    now
  )
  ctx.store.appendAuditEvent({
    missionId: approval.missionId,
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.lapsed',
    before: { status: approval.status },
    after: {
      id: approval.id,
      inputsHash: approval.inputsHash,
      expiresAt: approval.expiresAt,
      replacedBy: replacement.id
    },
    createdAt: now
  })
  return { expired: { approvalId: approval.id, replacedBy: replacement.id } }
}

export function result(value: ReturnType<typeof check>) {
  if (value.expired) {
    throw new MissionControllerError('approval_expired', value.expired)
  }
  return value.checked
}
