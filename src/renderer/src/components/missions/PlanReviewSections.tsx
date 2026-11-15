import { translate } from '@/i18n/i18n'
import type { GoalRevision, PlanRevision } from '../../../../shared/axiom-contract/mission-objects'
import { planCoverage } from '../../../../shared/axiom-contract/plan-coverage'
import { PlanReviewGroup } from './PlanReviewGroup'

export function PlanReviewSections({
  plan,
  goal
}: {
  plan: PlanRevision
  goal?: GoalRevision | null
}) {
  return (
    <>
      {plan.milestones.length > 0 && (
        <PlanReviewGroup title={translate('missions.planMilestones', 'Milestones')}>
          <ul className="space-y-2 text-sm">
            {plan.milestones.map((milestone) => (
              <li key={milestone.id}>
                <p>
                  {milestone.id} · {milestone.title}
                </p>
                <ul className="list-disc pl-5 text-xs text-muted-foreground">
                  {milestone.exitCriteria.map((criterion) => (
                    <li key={criterion}>{criterion}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </PlanReviewGroup>
      )}
      {plan.warnings.length > 0 && (
        <PlanReviewGroup title={translate('missions.planWarnings', 'Warnings')}>
          <ul className="space-y-3 text-xs">
            {plan.warnings.map((warning) => (
              <li key={JSON.stringify(warning)} className="space-y-1">
                <p className="font-mono">{warning.code}</p>
                <p className="whitespace-pre-wrap break-words">{warning.message}</p>
                {warning.code === 'incomplete_coverage' ? (
                  <ul>
                    {warning.uncovered.map(({ index, text }) => (
                      <li key={index}>
                        #{index} · {text}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <>
                    <p>{warning.taskIds.join(', ')}</p>
                    {warning.code === 'scope_overlap' ? (
                      <ul>
                        {warning.paths.map(({ a, b }) => (
                          <li key={`${a}:${b}`} className="break-all font-mono">
                            {a} ↔ {b}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p>
                        {translate(
                          'missions.planParallelRoots',
                          'Expected: {{expected}} · Found: {{found}}',
                          { expected: warning.expected, found: warning.found }
                        )}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </PlanReviewGroup>
      )}
      {goal?.id === plan.goalRevisionId && goal.acceptanceCriteria.length > 0 && (
        <PlanReviewGroup title={translate('missions.planGoalCoverage', 'Goal coverage')}>
          <ul className="space-y-2 text-xs">
            {planCoverage(plan, goal.acceptanceCriteria).criteria.map((criterion) => (
              <li key={criterion.index}>
                <p>
                  #{criterion.index} · {criterion.text}
                </p>
                <p className="text-muted-foreground">
                  {criterion.taskIds.length
                    ? criterion.taskIds.join(', ')
                    : translate('missions.planUncoveredCriterion', 'No Task covers it')}
                </p>
              </li>
            ))}
          </ul>
        </PlanReviewGroup>
      )}
    </>
  )
}
