import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { TaskStageBadge } from './TaskStageBadge'
import { taskWaitingGloss } from './task-waiting-copy'

export function TaskStageTable({
  tasks,
  selectedTaskId,
  onSelect
}: {
  tasks: readonly TaskListItem[]
  selectedTaskId?: string | null
  onSelect?: (taskId: string) => void
}) {
  return (
    <section className="space-y-3" aria-labelledby="mission-tasks-heading">
      <h2 id="mission-tasks-heading" className="text-sm font-semibold">
        {translate('missions.tasks', 'Tasks')}
      </h2>
      {tasks.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.noTasks', 'Tasks appear after a plan is approved.')}
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-sm"
            aria-label={translate('missions.tasks', 'Tasks')}
          >
            <thead>
              <tr className="border-b border-border">
                <th className="px-3 py-2 font-medium">{translate('missions.task', 'Task')}</th>
                <th className="px-3 py-2 font-medium">{translate('missions.stage', 'Stage')}</th>
                <th className="px-3 py-2 font-medium">
                  {translate('missions.waitingOn', 'Waiting on')}
                </th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.id}
                  className="cursor-pointer border-b border-border hover:bg-accent aria-selected:bg-accent"
                  data-task-id={task.id}
                  aria-selected={task.id === selectedTaskId}
                  tabIndex={0}
                  onClick={() => onSelect?.(task.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onSelect?.(task.id)
                    }
                  }}
                >
                  <td className="px-3 py-3 align-top">
                    {task.title}
                    <div className="text-xs text-muted-foreground">{task.id}</div>
                  </td>
                  <td className="px-3 py-3">
                    <TaskStageBadge stage={task.stage} orcaStatus={task.orcaStatus} />
                  </td>
                  <td className="px-3 py-3 align-top">
                    {task.waitingOn && (
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <p>{taskWaitingGloss(task.waitingOn)}</p>
                        <p className="font-mono">
                          {task.waitingOn.on} · {task.waitingOn.reason}
                        </p>
                        {task.waitingOn.person && (
                          <span className="bg-status-warning-background text-status-warning">
                            {translate('missions.needsPerson', 'Needs a person')}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
