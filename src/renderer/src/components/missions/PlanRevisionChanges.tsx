import { translate } from '@/i18n/i18n'
import type { PlanRevision } from '../../../../shared/axiom-contract/mission-objects'
import { planRevisionDiff, type TaskChanges } from './plan-revision-diff'
import { PlanAcceptance } from './PlanAcceptance'
import { PlanReviewGroup } from './PlanReviewGroup'

function ChangedTask({ change }: { change: TaskChanges }) {
  const occurrences = new Map<string, number>()
  const labels = {
    title: translate('missions.planTaskTitle', 'Title'),
    objective: translate('missions.objective', 'Objective'),
    role: translate('missions.planRole', 'Role'),
    risk: translate('missions.planRiskLevel', 'Risk level'),
    attemptLimit: translate('missions.attemptLimit', 'Attempt limit'),
    milestone: translate('missions.planMilestone', 'Milestone'),
    kind: translate('missions.planTaskKind', 'Kind'),
    paths: translate('missions.allowedPaths', 'Allowed paths'),
    acceptance: translate('missions.acceptanceCriteria', 'Acceptance criteria'),
    coverage: translate('missions.planGoalCriteriaCovered', 'Goal criteria covered'),
    budget: translate('missions.planDeclaredBudgetLimits', 'Declared budget limits')
  }
  return (
    <li className="space-y-2">
      <p className="font-medium">
        {change.task.id} · {change.task.title}
      </p>
      <dl className="space-y-2 text-xs">
        {change.scalars.map((part) => (
          <div key={part.field}>
            <dt className="text-muted-foreground">{labels[part.field]}</dt>
            <dd className="whitespace-pre-wrap break-words">
              {part.before ?? translate('missions.planNotDeclared', 'Not declared')} →{' '}
              {part.after ?? translate('missions.planNotDeclared', 'Not declared')}
            </dd>
          </div>
        ))}
        {change.lists.map((part) => (
          <div key={part.field} className="space-y-1">
            <dt className="text-muted-foreground">{labels[part.field]}</dt>
            {(
              [
                [translate('missions.planRemoved', 'Removed'), part.removed],
                [translate('missions.planAdded', 'Added'), part.added]
              ] as const
            ).map(([label, entries]) => (
              <dd key={label}>
                <ul className="space-y-1">
                  {entries.map((entry) => {
                    const identity = JSON.stringify([part.field, label, entry])
                    const occurrence = occurrences.get(identity) ?? 0
                    occurrences.set(identity, occurrence + 1)
                    return (
                      <li key={`${identity}:${occurrence}`}>
                        {typeof entry === 'string' ? (
                          <p className="break-all">
                            {label}: {entry}
                          </p>
                        ) : (
                          <>
                            <p>{label}:</p>
                            <PlanAcceptance criterion={entry} />
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </li>
  )
}

export function PlanRevisionChanges({
  plan,
  previous
}: {
  plan: PlanRevision
  previous: PlanRevision
}) {
  const diff = planRevisionDiff(previous, plan)
  return (
    <PlanReviewGroup
      title={translate('missions.planChangesSince', 'Changes since revision {{revision}}', {
        revision: previous.revision
      })}
    >
      <div className="space-y-1 text-sm">
        <p className="text-muted-foreground">
          {translate('missions.planRejectedBecause', 'Rejected because')}
        </p>
        <p className="whitespace-pre-wrap break-words">{previous.rejectedReason}</p>
      </div>
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.planTaskMatching',
          'Tasks are matched by id, so a Task whose id changed shows as removed and added.'
        )}
      </p>
      {(
        [
          [translate('missions.planAddedTasks', 'Added Tasks'), diff.tasks.added],
          [translate('missions.planRemovedTasks', 'Removed Tasks'), diff.tasks.removed]
        ] as const
      ).map(
        ([title, tasks]) =>
          tasks.length > 0 && (
            <PlanReviewGroup key={title} title={title}>
              <ul className="space-y-1 text-sm">
                {tasks.map((task) => (
                  <li key={task.id}>
                    {task.id} · {task.title}
                  </li>
                ))}
              </ul>
            </PlanReviewGroup>
          )
      )}
      {diff.changed.length > 0 && (
        <PlanReviewGroup title={translate('missions.planChangedTasks', 'Changed Tasks')}>
          <ul className="space-y-3 text-sm">
            {diff.changed.map((change) => (
              <ChangedTask key={change.task.id} change={change} />
            ))}
          </ul>
        </PlanReviewGroup>
      )}
      {(diff.edges.removed.length > 0 || diff.edges.added.length > 0) && (
        <PlanReviewGroup title={translate('missions.planDependencyChanges', 'Dependency changes')}>
          <ul className="space-y-1 text-xs">
            {(
              [
                [translate('missions.planRemoved', 'Removed'), diff.edges.removed],
                [translate('missions.planAdded', 'Added'), diff.edges.added]
              ] as const
            ).flatMap(([label, edges]) =>
              edges.map((edge) => (
                <li key={`${label}:${edge.fromTaskId}:${edge.toTaskId}:${edge.readinessThreshold}`}>
                  {label}: {edge.fromTaskId} → {edge.toTaskId} · {edge.readinessThreshold}
                </li>
              ))
            )}
          </ul>
        </PlanReviewGroup>
      )}
      {diff.milestones && (
        <p className="text-xs">
          {translate('missions.planMilestonesChanged', 'Milestones changed.')}
        </p>
      )}
      {diff.risks && (
        <p className="text-xs">{translate('missions.planRisksChanged', 'Risks changed.')}</p>
      )}
      {!diff.any && (
        <p className="text-xs">
          {translate('missions.planNoDifference', 'No difference from revision {{revision}}.', {
            revision: previous.revision
          })}
        </p>
      )}
    </PlanReviewGroup>
  )
}
