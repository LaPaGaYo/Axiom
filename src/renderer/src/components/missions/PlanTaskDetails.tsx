import { useId } from 'react'
import { translate } from '@/i18n/i18n'
import type { PlanRevision, TaskSpec } from '../../../../shared/axiom-contract/mission-objects'
import {
  resolveVerificationPlan,
  type VerificationRules
} from '../../../../shared/axiom-contract/verification-rules'
import { PlanAcceptance, reviewCriteria } from './PlanAcceptance'
import { PlanReviewGroup } from './PlanReviewGroup'

function TaskVerification({
  task,
  rules,
  policyUnavailable
}: {
  task: TaskSpec
  rules: VerificationRules | null
  policyUnavailable: boolean
}) {
  if (policyUnavailable) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.planPolicyReadError',
          "The Mission's policy could not be read, so the commands verification will run are not listed. Refresh to try again."
        )}
      </p>
    )
  }
  if (!rules) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.planPolicyInvalid',
          "The Mission's verification rules are not valid. Verification would end INCONCLUSIVE (policy_invalid) without running a command."
        )}
      </p>
    )
  }
  const commands = resolveVerificationPlan(task, rules)
  const occurrences = new Map<string, number>()
  const title = translate('missions.verificationWillRun', 'Verification will run')
  return (
    <PlanReviewGroup title={title}>
      {commands.length ? (
        <ol aria-label={title} className="space-y-2 text-xs">
          {commands.map(({ source, command }) => {
            const identity = `${source}:${command}`
            const occurrence = occurrences.get(identity) ?? 0
            occurrences.set(identity, occurrence + 1)
            return (
              <li key={`${identity}:${occurrence}`}>
                <span className="font-mono text-muted-foreground">{source}</span>
                <code className="block whitespace-pre-wrap break-all font-mono">{command}</code>
              </li>
            )
          })}
        </ol>
      ) : (
        <p className="text-xs text-muted-foreground">
          {translate('missions.planNoCommands', 'No command will run for this Task.')}
        </p>
      )}
    </PlanReviewGroup>
  )
}

export function PlanTaskDetails({
  task,
  plan,
  rules,
  policyUnavailable
}: {
  task: TaskSpec
  plan: PlanRevision
  rules: VerificationRules | null
  policyUnavailable: boolean
}) {
  const titleId = useId()
  const milestone = plan.milestones.find(({ id }) => id === task.milestoneId)
  const acceptanceTitle = translate('missions.acceptanceCriteria', 'Acceptance criteria')
  return (
    <li aria-labelledby={titleId} className="space-y-3 border-t border-border pt-3">
      <div className="space-y-1">
        <p id={titleId} className="font-medium">
          {task.id} · {task.title}
        </p>
        <p className="whitespace-pre-wrap break-words">{task.objective}</p>
      </div>
      <dl className="space-y-2 text-xs">
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.allowedPaths', 'Allowed paths')}
          </dt>
          <dd>
            {task.scope.allowedPaths.length ? (
              <ul className="space-y-1">
                {task.scope.allowedPaths.map((path) => (
                  <li key={path} className="break-all font-mono">
                    {path}
                  </li>
                ))}
              </ul>
            ) : (
              translate('missions.noAllowedPaths', 'None')
            )}
          </dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.planRiskLevel', 'Risk level')}
          </dt>
          <dd>{task.risk}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.attemptLimit', 'Attempt limit')}
          </dt>
          <dd>{task.retryPolicy.maxAttempts}</dd>
        </div>
        <div className="space-y-1">
          <dt className="text-muted-foreground">
            {translate('missions.tokenLimit', 'Token limit')}
          </dt>
          <dd>{task.budget?.maxTokens ?? translate('missions.noTokenLimit', 'No limit')}</dd>
        </div>
        {Object.entries(task.budget ?? {})
          .filter(([field, value]) => field !== 'maxTokens' && value !== undefined)
          .map(([field, value]) => (
            <div key={field} className="space-y-1">
              <dt className="font-mono text-muted-foreground">{field}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        {task.milestoneId && (
          <div className="space-y-1">
            <dt className="text-muted-foreground">
              {translate('missions.planMilestone', 'Milestone')}
            </dt>
            <dd>
              {task.milestoneId}
              {milestone && <> · {milestone.title}</>}
            </dd>
          </div>
        )}
        {task.role && (
          <div className="space-y-1">
            <dt className="text-muted-foreground">{translate('missions.planRole', 'Role')}</dt>
            <dd>{task.role}</dd>
          </div>
        )}
      </dl>
      <PlanReviewGroup title={acceptanceTitle}>
        <ul aria-label={acceptanceTitle} className="space-y-3 text-xs">
          {reviewCriteria(task).map(({ criterion, key }) => (
            <li key={key} className="space-y-1">
              <PlanAcceptance criterion={criterion} explain />
            </li>
          ))}
        </ul>
      </PlanReviewGroup>
      {plan.status === 'PROPOSED' && (
        <TaskVerification task={task} rules={rules} policyUnavailable={policyUnavailable} />
      )}
    </li>
  )
}
