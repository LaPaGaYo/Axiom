import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { z } from 'zod'
import type { AttemptSummary } from '../../../../shared/axiom-contract/attempt-params'
import type { MessageSummaryResponseSchema } from '../../../../shared/axiom-contract/message-params'
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
  attempts,
  pendingMessages,
  onSelectTask,
  proposedPlans,
  busy,
  onAction
}: {
  mission: MissionSummary
  goal: GoalRevision | null
  tasks: readonly TaskListItem[]
  attempts: readonly AttemptSummary[]
  pendingMessages: readonly z.infer<typeof MessageSummaryResponseSchema>[]
  onSelectTask: (taskId: string) => void
  proposedPlans: number
  busy: boolean
  onAction: (action: MissionAction) => void
}) {
  useTranslation()
  const counts = countTaskStages(tasks)
  const workers = attempts.filter((attempt) => attempt.role === 'worker')
  const running = workers.filter((attempt) => attempt.state === 'RUNNING').length
  const submitted = workers.filter((attempt) => attempt.state === 'SUBMITTED').length
  const plannerInProgress = attempts.some(
    (attempt) => attempt.role === 'planner' && ['STARTING', 'RUNNING'].includes(attempt.state)
  )
  const pending = pendingMessages.filter(
    (message) => message.pending && ['QUESTION', 'REQUEST_SUBTASK'].includes(message.type)
  )
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
        <p className="text-sm tabular-nums" data-testid="mission-attempt-progress">
          {translate('missions.attemptProgress', '{{running}} running / {{submitted}} submitted', {
            running,
            submitted
          })}
        </p>
        {plannerInProgress && (
          <p role="status" className="text-sm">
            {translate('missions.plannerInProgress', 'Planner in progress')}
          </p>
        )}
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
        <p className="text-sm">
          {translate('missions.pendingCount', '{{total}} pending item(s)', {
            total: pending.length
          })}
        </p>
        {pending.length > 0 && (
          <ul className="space-y-2" aria-label={translate('missions.pending', 'Pending items')}>
            {pending.map((message) => (
              <li key={message.id} className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">{message.type}</Badge>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto whitespace-normal text-left"
                  onClick={() => onSelectTask(message.taskId)}
                >
                  {message.summary}
                </Button>
              </li>
            ))}
          </ul>
        )}
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
            ? translate('missions.awaitPlan', 'Start Planner to propose a plan for review.')
            : mission.status === 'PLAN_REVIEW'
              ? translate('missions.reviewNext', 'Review the proposed plan below.')
              : mission.status === 'PLANNED'
                ? translate('missions.startNext', 'Start the approved plan when ready.')
                : mission.status === 'EXECUTING'
                  ? translate(
                      'missions.executingNext',
                      '{{running}} Attempt(s) running, {{submitted}} submitted — verification arrives in M3.',
                      { running, submitted }
                    )
                  : translate(
                      'missions.statusNext',
                      'Review the Mission status and pending items.'
                    )}
        </p>
      </div>
      <MissionActions
        status={mission.status}
        busy={busy}
        onAction={onAction}
        plannerInProgress={plannerInProgress}
        proposedPlans={proposedPlans}
      />
    </section>
  )
}
