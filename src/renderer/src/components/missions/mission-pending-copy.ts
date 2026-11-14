import { translate } from '@/i18n/i18n'
import type {
  MissionPendingItem,
  PendingAction
} from '../../../../shared/axiom-contract/mission-pending'

export function pendingKindLabel(kind: MissionPendingItem['kind']): string {
  const labels = {
    mission: translate('missions.pendingKindMission', 'Mission'),
    plan_review: translate('missions.pendingKindPlanReview', 'Plan review'),
    question: translate('missions.pendingKindQuestion', 'Question'),
    human_review: translate('missions.pendingKindReview', 'Review'),
    task_blocked: translate('missions.pendingKindBlockedTask', 'Blocked Task'),
    subtask_request: translate('missions.pendingKindSubtaskRequest', 'Subtask request'),
    follow_up: translate('missions.pendingKindFollowUp', 'Follow-up'),
    stall_notice: translate('missions.pendingKindStallNotice', 'Stall notice'),
    supervision_proposal: translate(
      'missions.pendingKindSupervisionProposal',
      'Supervision proposal'
    )
  }
  return labels[kind]
}

export function pendingActionLabel(action: PendingAction): string {
  const labels = {
    'axiom.mission.start': translate('missions.start', 'Start Mission'),
    'axiom.mission.resume': translate('missions.resume', 'Resume Mission'),
    'axiom.mission.plan': translate('missions.startPlanner', 'Start Planner'),
    'axiom.mission.cancel': translate('missions.cancel', 'Cancel Mission'),
    'axiom.plan.approve': translate('missions.approvePlan', 'Approve plan'),
    'axiom.plan.reject': translate('missions.rejectPlan', 'Reject plan'),
    'axiom.message.answer': translate('missions.answer', 'Answer'),
    'axiom.message.resolve': translate('missions.pendingAcceptOrReject', 'Accept or reject'),
    'axiom.verification.resolve': translate('missions.resolveReview', 'Resolve review'),
    'axiom.verification.rerun': translate('missions.rerunVerification', 'Rerun verification'),
    'axiom.task.adjust': translate('missions.adjustTask', 'Adjust Task'),
    'axiom.task.cancel': translate('missions.cancelTask', 'Cancel Task'),
    'axiom.policy.update': translate('missions.pendingUpdatePolicy', 'Update policy'),
    'axiom.supervision.resolve': translate('missions.pendingResolveProposal', 'Resolve proposal')
  }
  return labels[action]
}
