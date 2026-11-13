import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { taskWaitingGloss } from './task-waiting-copy'

export function TaskWaitingLine({
  task,
  tasks,
  onSelectTask,
  onSelectRun
}: {
  task: TaskListItem
  tasks?: readonly TaskListItem[]
  onSelectTask?: (id: string) => void
  onSelectRun: (id: string) => void
}) {
  const wait = task.waitingOn
  if (!wait) {
    return null
  }
  return (
    <section
      aria-labelledby="task-wait-heading"
      className="space-y-1 text-xs text-muted-foreground"
    >
      <h3 id="task-wait-heading" className="font-medium">
        {translate('missions.waitingOn', 'Waiting on')}
      </h3>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono">
          {wait.on} · {wait.reason}
        </span>
        {wait.person && (
          <span className="bg-status-warning-background text-status-warning">
            {translate('missions.needsPerson', 'Needs a person')}
          </span>
        )}
      </div>
      <p>{taskWaitingGloss(wait)}</p>
      {!!wait.taskIds?.length && (
        <div className="flex flex-wrap gap-2">
          {wait.taskIds.map((id) => (
            <Button
              key={id}
              variant="link"
              size="xs"
              className="h-auto whitespace-normal"
              onClick={() => onSelectTask?.(id)}
            >
              {tasks?.find((entry) => entry.id === id)?.title ?? id}
            </Button>
          ))}
        </div>
      )}
      {wait.missionStatus && (
        <p>
          {translate('missions.missionStatus', 'Mission status')}:{' '}
          <span className="font-mono">{wait.missionStatus}</span>
        </p>
      )}
      {wait.budget && (
        <p className="tabular-nums">
          {wait.budget.scope === 'mission'
            ? translate('missions.missionBudget', 'Mission budget')
            : translate('missions.taskBudget', 'Task budget')}
          {' · '}
          <span className="font-mono">{wait.budget.dimension}</span>
          {' · '}
          {translate('missions.budgetReading', '{{used}} of {{limit}}', {
            used: wait.budget.used,
            limit: wait.budget.limit
          })}
        </p>
      )}
      {wait.until && (
        <p>
          {translate('missions.waitUntil', 'Until')}:{' '}
          <time dateTime={wait.until} className="tabular-nums">
            {new Date(wait.until).toLocaleString()}
          </time>
        </p>
      )}
      {wait.seq !== undefined && (
        <p>{translate('missions.waitAttempt', 'Attempt {{seq}}', { seq: wait.seq })}</p>
      )}
      {wait.runId && (
        <Button
          variant="link"
          size="xs"
          className="h-auto break-all"
          onClick={() => onSelectRun(wait.runId!)}
        >
          {wait.runId}
        </Button>
      )}
    </section>
  )
}
