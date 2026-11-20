import { current, type DeliveryInput } from '../approval/delivery-check'
import { consume } from '../approval/delivery-consumption'
import {
  audit,
  MissionControllerError,
  type ControllerContext
} from '../mission-controller/controller-context'
import { moveMission, projectMission } from '../mission-controller/mission-lifecycle'

export const DELIVERY_STOPPED_EVENT = 'mission.delivery_stopped'
export type DeliveryStopReason =
  | 'remote_configured'
  | 'integration_head_unexpected'
  | 'signature_verification_required'
  | 'target_checked_out'
export type DeliveryWrite = DeliveryInput &
  (
    | { kind: 'started' }
    | { kind: 'stopped'; reason: DeliveryStopReason; worktreePath?: string }
    | { kind: 'inputs_changed'; reason: 'target_branch_moved' | 'target_branch_not_found' }
    | { kind: 'completed'; outcome: 'fast_forwarded' | 'up_to_date' }
  )

export function settle(ctx: ControllerContext, input: DeliveryWrite) {
  const checked = current(ctx, input)
  const { mission, approval, record } = checked
  const identity = { missionId: mission.id, approvalId: approval.id }
  if (input.kind === 'inputs_changed') {
    moveMission(
      ctx,
      mission.id,
      'READY_FOR_APPROVAL',
      'FINALIZING',
      'MissionController',
      input.reason
    )
    return {
      finalize: true,
      refusal: new MissionControllerError('delivery_inputs_changed', {
        ...identity,
        reason: input.reason
      })
    }
  }
  if (input.kind === 'stopped') {
    const details = {
      approvalId: approval.id,
      reason: input.reason,
      targetBranch: record.targetBranch,
      ...(input.worktreePath === undefined ? {} : { worktreePath: input.worktreePath })
    }
    audit(ctx, {
      missionId: mission.id,
      actor: 'MissionController',
      objectKind: 'mission',
      objectId: mission.id,
      event: DELIVERY_STOPPED_EVENT,
      before: null,
      after: { ...details, via: input.via }
    })
    return {
      refusal: new MissionControllerError('delivery_stopped', { missionId: mission.id, ...details })
    }
  }
  if (input.kind === 'started') {
    audit(ctx, {
      missionId: mission.id,
      actor: 'user',
      objectKind: 'mission',
      objectId: mission.id,
      event: 'mission.delivery_started',
      before: null,
      after: {
        approvalId: approval.id,
        targetBranch: record.targetBranch,
        from: record.targetHead ?? null,
        to: record.integrationHead ?? null,
        via: input.via
      }
    })
    return { mission: projectMission(ctx, mission.id), approval }
  }
  const consumed = consume(ctx, checked, input.outcome, input.via)
  if (!consumed) {
    throw new MissionControllerError('stale_state', { approvalId: approval.id })
  }
  return {
    mission: moveMission(
      ctx,
      mission.id,
      'READY_FOR_APPROVAL',
      'COMPLETED',
      'MissionController',
      'delivered'
    ),
    approval: consumed
  }
}

// Called only after the controller write has committed, including the scheduler request.
export function result(value: ReturnType<typeof settle>, schedule: () => void) {
  if (value.finalize) {
    schedule()
  }
  if (value.refusal) {
    throw value.refusal
  }
  return { mission: value.mission, approval: value.approval }
}
