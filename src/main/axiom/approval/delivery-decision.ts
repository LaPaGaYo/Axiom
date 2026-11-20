import type { Approval } from '../../../shared/axiom-contract/approval'
import { OrchestrationError } from '../../runtime/orchestration/orchestration-error'
import {
  MissionControllerError,
  requireMission,
  type ControllerContext
} from '../mission-controller/controller-context'
import { interruptMission } from '../mission-controller/mission-lifecycle'
import { missionFinalization } from '../read-models/finalization-reads'
import { redactContext } from '../redaction/redaction'
import { requestDeliveryApproval } from './delivery-approval'

type DecisionInput = { approvalId: string; via: string }

function pendingDelivery(ctx: ControllerContext, approvalId: string, command: 'grant' | 'deny') {
  const approval = ctx.store.getApproval(approvalId)
  if (!approval || approval.actionKind !== 'delivery') {
    throw new MissionControllerError('approval_not_found', { approvalId })
  }
  if (approval.status !== 'PENDING') {
    throw new MissionControllerError('approval_not_pending', {
      approvalId,
      status: approval.status
    })
  }
  const mission = requireMission(ctx, approval.missionId)
  if (mission.status !== 'READY_FOR_APPROVAL') {
    throw new MissionControllerError('illegal_transition', {
      missionId: mission.id,
      from: mission.status,
      command
    })
  }
  return approval
}

function transition(
  ctx: ControllerContext,
  approval: Approval,
  status: 'GRANTED' | 'DENIED' | 'EXPIRED',
  resolver: string,
  resolution: string
) {
  if (
    !ctx.store.transitionApproval({
      id: approval.id,
      expectedStatus: 'PENDING',
      status,
      resolver,
      resolution
    })
  ) {
    throw new MissionControllerError('stale_state', { approvalId: approval.id })
  }
  const updated = ctx.store.getApproval(approval.id)
  if (!updated) {
    throw new MissionControllerError('stale_state', { approvalId: approval.id })
  }
  return updated
}

// The controller owns the write. Expiry is returned, never thrown inside it.
export function grant(ctx: ControllerContext, input: DecisionInput) {
  const approval = pendingDelivery(ctx, input.approvalId, 'grant')
  const record = missionFinalization(ctx.store, approval.missionId)
  if (record?.outcome !== 'ready' || record.reportSha256 !== approval.inputsHash) {
    throw new MissionControllerError('approval_stale', { approvalId: approval.id })
  }
  const now = ctx.now()
  if (!(Date.parse(approval.expiresAt) > Date.parse(now))) {
    transition(ctx, approval, 'EXPIRED', 'MissionController', 'expired')
    ctx.store.appendAuditEvent({
      missionId: approval.missionId,
      actor: 'MissionController',
      objectKind: 'approval',
      objectId: approval.id,
      event: 'approval.expired',
      before: { status: approval.status },
      after: { id: approval.id, inputsHash: approval.inputsHash, expiresAt: approval.expiresAt },
      createdAt: now
    })
    const replacement = requestDeliveryApproval(
      ctx.store,
      approval.missionId,
      approval.inputsHash,
      now
    )
    return { expired: { approvalId: approval.id, replacedBy: replacement.id } }
  }
  const updated = transition(ctx, approval, 'GRANTED', 'user', 'granted')
  ctx.store.appendAuditEvent({
    missionId: approval.missionId,
    actor: 'user',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.granted',
    before: { status: approval.status },
    after: {
      id: approval.id,
      inputsHash: approval.inputsHash,
      expiresAt: approval.expiresAt,
      via: input.via
    },
    createdAt: now
  })
  return { approval: updated }
}

export function grantResult(result: ReturnType<typeof grant>) {
  if (result.expired) {
    throw new MissionControllerError('approval_expired', result.expired)
  }
  return result.approval
}

export function validateDenial(reason: string): void {
  if (redactContext(reason).redacted) {
    throw new OrchestrationError('invalid_argument', 'secret_in_rationale')
  }
}

export function deny(ctx: ControllerContext, input: DecisionInput & { reason: string }) {
  const approval = pendingDelivery(ctx, input.approvalId, 'deny')
  const updated = transition(ctx, approval, 'DENIED', 'user', input.reason)
  ctx.store.appendAuditEvent({
    missionId: approval.missionId,
    actor: 'user',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.denied',
    before: { status: approval.status },
    after: { id: approval.id, reason: input.reason, via: input.via },
    createdAt: ctx.now()
  })
  interruptMission(ctx, approval.missionId, 'BLOCKED', 'delivery_denied')
  return updated
}
