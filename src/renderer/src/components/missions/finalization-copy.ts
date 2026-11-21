import { translate } from '@/i18n/i18n'
import type {
  FinalizationGateItem,
  FinalizationOutcome
} from '../../../../shared/axiom-contract/mission-finalization'
import type { CompletionReport } from '../../../../shared/axiom-contract/completion-report'

export function finalizationGateLabel(id: FinalizationGateItem['id']): string {
  switch (id) {
    case 'tasks_settled':
      return translate(
        'missions.gateTasksSettled',
        'Every Task is integrated or canceled, and at least one is integrated'
      )
    case 'candidates_verified':
      return translate(
        'missions.gateCandidatesVerified',
        'The candidate of every integrated Task passed verification'
      )
    case 'batches_promoted':
      return translate(
        'missions.gateBatchesPromoted',
        'The batch of every integrated Task is promoted and its merged-tree regression passed'
      )
    case 'integration_head_recorded':
      return translate(
        'missions.gateIntegrationHeadRecorded',
        'The integration branch is at the commit the Control Plane recorded'
      )
    case 'target_branch_contained':
      return translate(
        'missions.gateTargetBranchContained',
        'The integration branch contains the target branch'
      )
    case 'no_open_questions':
      return translate(
        'missions.gateNoOpenQuestions',
        'No question or gate is pending on an unfinished Task and no approval blocks the Mission'
      )
    case 'goal_criteria_covered':
      return translate(
        'missions.gateGoalCriteriaCovered',
        'Every acceptance criterion of the Goal is covered by an integrated Task'
      )
    case 'limitations_recorded':
      return translate(
        'missions.gateLimitationsRecorded',
        'The submission of every integrated Task is on record'
      )
  }
}

export function finalizationStopLabel(
  reason: Extract<FinalizationOutcome, { outcome: 'stopped' }>['reason']
): string {
  switch (reason) {
    case 'target_branch_moved':
      return translate(
        'missions.stopTargetBranchMoved',
        'The target branch has commits the integration branch does not contain'
      )
    case 'target_branch_not_found':
      return translate('missions.stopTargetBranchNotFound', 'The local target branch was not found')
    case 'integration_head_unexpected':
      return translate(
        'missions.stopIntegrationHeadUnexpected',
        'The integration branch is not at the commit the Control Plane recorded'
      )
    case 'completion_gate_failed':
      return translate(
        'missions.stopCompletionGateFailed',
        'At least one completion gate item did not pass'
      )
    case 'finalization_unavailable':
      return translate(
        'missions.stopFinalizationUnavailable',
        'Finalization could not read the repository or store the report after three tries'
      )
  }
}

export function reportRiskLabel(kind: CompletionReport['risks'][number]['kind']): string {
  switch (kind) {
    case 'bypass_posture':
      return translate(
        'missions.riskBypassPosture',
        'An Attempt ran as a terminal agent, not in the headless sandbox'
      )
    case 'human_resolved_verification':
      return translate(
        'missions.riskHumanResolvedVerification',
        'A person resolved the verification of this Task'
      )
  }
}
