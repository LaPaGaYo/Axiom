import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { TASK_STAGES } from '../../../../shared/axiom-contract/lifecycle'
import {
  countTaskStages,
  MISSION_STATUS_LABELS,
  TASK_STAGE_LABELS
} from '../../../../shared/axiom-contract/stage-labels'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import type { GoalRevision } from '../../../../shared/axiom-contract/mission-objects'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { MissionActions, type MissionAction } from './MissionActions'

export function MissionHome({
  mission,
  goal,
  tasks,
  proposedPlans,
  busy,
  onAction
}: {
  mission: MissionSummary
  goal: GoalRevision | null
  tasks: readonly TaskListItem[]
  proposedPlans: number
  busy: boolean
  onAction: (action: MissionAction) => void
}) {
  useTranslation()
  const counts = countTaskStages(tasks)
  return (
    <section className="space-y-5" aria-labelledby="mission-home-heading">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 id="mission-home-heading" className="text-lg font-semibold">
            {translate('missions.home', 'Mission Home')}
          </h1>
          <Badge variant="secondary" data-mission-status={mission.status}>
            {translate(
              `missions.statuses.${mission.status}`,
              MISSION_STATUS_LABELS[mission.status].en
            )}
          </Badge>
        </div>
        <p className="break-all text-xs text-muted-foreground">
          {mission.repoPath} · {mission.targetBranch} · {mission.id}
        </p>
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{translate('missions.goal', 'Goal')}</h2>
        <p className="whitespace-pre-wrap text-sm">
          {goal?.objective ?? translate('missions.noGoal', 'No active Goal revision.')}
        </p>
        {goal && (
          <>
            <h3 className="text-xs font-medium">
              {translate('missions.acceptanceCriteria', 'Acceptance criteria')}
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {goal.acceptanceCriteria.map((criterion, i) => (
                <li key={`${i}:${criterion}`}>{criterion}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{translate('missions.progress', 'Progress')}</h2>
        <p className="text-sm" data-testid="mission-progress">
          {translate('missions.integratedCount', '{{integrated}} / {{total}} Tasks integrated', {
            integrated: counts.INTEGRATED,
            total: tasks.length
          })}
        </p>
        <dl
          className="flex flex-wrap gap-x-4 gap-y-2 text-xs"
          aria-label={translate('missions.stageCounts', 'Task stage counts')}
        >
          {TASK_STAGES.filter((stage) => counts[stage] > 0).map((stage) => (
            <div key={stage} className="flex gap-2">
              <dt className="text-muted-foreground">
                {translate(`missions.stages.${stage}`, TASK_STAGE_LABELS[stage].en)}
              </dt>
              <dd className="tabular-nums">{counts[stage]}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{translate('missions.pending', 'Pending items')}</h2>
        {proposedPlans > 0 && (
          <p className="text-sm">
            {translate('missions.proposedPlans', '{{total}} proposed plan(s) to review below.', {
              total: proposedPlans
            })}
          </p>
        )}
        {mission.status === 'BLOCKED' || mission.status === 'PAUSED' ? (
          <p className="text-sm">
            {mission.reason ??
              translate('missions.reasonUnavailable', 'The runtime has not supplied a reason.')}
          </p>
        ) : (
          proposedPlans === 0 && (
            <p className="text-sm text-muted-foreground">
              {translate('missions.noPending', 'No plan awaiting review.')}
            </p>
          )
        )}
      </div>
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">{translate('missions.nextStep', 'Next step')}</h2>
        <p className="text-sm text-muted-foreground">
          {mission.status === 'ANALYZING'
            ? translate('missions.awaitPlan', 'Awaiting a plan proposal (M1: axiom plan propose).')
            : mission.status === 'PLAN_REVIEW'
              ? translate('missions.reviewNext', 'Review the proposed plan below.')
              : mission.status === 'PLANNED'
                ? translate('missions.startNext', 'Start the approved plan when ready.')
                : mission.status === 'EXECUTING'
                  ? translate(
                      'missions.executingNext',
                      'No further action in M1. Worker execution arrives in M2.'
                    )
                  : translate(
                      'missions.statusNext',
                      'Review the Mission status and pending items.'
                    )}
        </p>
      </div>
      <MissionActions status={mission.status} busy={busy} onAction={onAction} />
    </section>
  )
}
