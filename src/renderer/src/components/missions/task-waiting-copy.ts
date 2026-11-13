import { translate } from '@/i18n/i18n'
import type { TaskWaitingOn } from '../../../../shared/axiom-contract/task-waiting-on'

export function taskWaitingGloss(wait: TaskWaitingOn): string {
  switch (wait.reason) {
    case 'upstream_canceled':
      return translate('missions.waitUpstreamCanceled', 'An upstream Task was canceled.')
    case 'budget_exhausted':
      return translate('missions.waitMissionBudget', 'The Mission budget is exhausted.')
    case 'task_tokens':
    case 'token_budget_exhausted':
      return translate('missions.waitTaskTokens', 'The Task token budget is exhausted.')
    case 'task_attempts':
    case 'retry_budget_exhausted':
      return translate('missions.waitTaskAttempts', 'The Task Attempt budget is exhausted.')
    case 'backoff':
      return translate('missions.waitBackoff', 'Waiting until the recorded retry time.')
    case 'concurrency':
      return translate('missions.waitConcurrency', 'Waiting for execution capacity.')
    case 'no_eligible_provider':
      return translate(
        'missions.waitProvider',
        'No eligible provider was available at the last admission check.'
      )
    case 'next_round':
      return translate('missions.waitNextRound', 'Waiting for the next admission round.')
    case 'integrated':
      return translate('missions.waitIntegrated', 'This Task is integrated.')
    case 'canceled':
      return translate('missions.waitCanceled', 'This Task was canceled.')
  }
  const gloss = {
    none: translate('missions.waitNone', 'No wait is recorded.'),
    mission: translate('missions.waitMission', 'Waiting on the Mission or its plan.'),
    dependency: translate(
      'missions.waitDependency',
      'Waiting for upstream Tasks to be integrated.'
    ),
    question: translate('missions.waitQuestion', 'Waiting for an answer to a question.'),
    approval: translate('missions.waitApproval', 'Waiting for an approval.'),
    budget: translate('missions.waitBudget', 'A budget limit is holding this Task.'),
    admission: translate('missions.waitAdmission', 'Waiting for admission to execution.'),
    verification: translate('missions.waitVerification', 'Waiting on verification.'),
    integration: translate('missions.waitIntegration', 'Waiting in the integration queue.'),
    human: translate('missions.waitHuman', 'Waiting for a person to review or resolve this Task.'),
    running: translate('missions.waitRunning', 'An Attempt is running.')
  }
  return gloss[wait.on]
}
