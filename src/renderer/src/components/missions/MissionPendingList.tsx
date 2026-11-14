import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { pendingActionLabel, pendingKindLabel } from './mission-pending-copy'
import { taskWaitingGloss } from './task-waiting-copy'

const NO_ITEMS: readonly MissionPendingItem[] = []

export function MissionPendingList({
  items = NO_ITEMS,
  failed = false,
  tasks,
  onSelectTask
}: {
  items?: readonly MissionPendingItem[]
  failed?: boolean
  tasks: readonly TaskListItem[]
  onSelectTask: (id: string) => void
}) {
  if (failed) {
    return (
      <p className="text-sm text-muted-foreground">
        {translate(
          'missions.pendingReadError',
          'Pending items could not be read. Refresh to try again.'
        )}
      </p>
    )
  }
  return (
    <>
      <p className="text-sm">
        {translate('missions.pendingCount', '{{total}} pending item(s)', { total: items.length })}
      </p>
      {items.length > 0 && (
        <ul className="space-y-3" aria-label={translate('missions.pending', 'Pending items')}>
          {items.map((item) => {
            const task = item.taskId ? tasks.find((entry) => entry.id === item.taskId) : undefined
            const wait = ['mission', 'human_review', 'task_blocked'].includes(item.kind)
              ? item.waitingOn
              : undefined
            return (
              <li key={item.id} className="space-y-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{pendingKindLabel(item.kind)}</Badge>
                  {task ? (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto whitespace-normal text-left"
                      onClick={() => onSelectTask(task.id)}
                    >
                      {task.title}
                    </Button>
                  ) : item.taskId ? (
                    <span className="break-all text-xs text-muted-foreground">{item.taskId}</span>
                  ) : null}
                </div>
                <p className="break-all font-mono text-xs">{item.reason}</p>
                {wait && <p className="text-muted-foreground">{taskWaitingGloss(wait)}</p>}
                {wait?.budget && (
                  <p className="tabular-nums text-muted-foreground">
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
                {item.summary && <p className="whitespace-pre-wrap">{item.summary}</p>}
                {item.blocking ? (
                  item.blocks > 0 && (
                    <p>
                      {translate('missions.pendingBlocks', 'Blocks {{count}} Task(s)', {
                        count: item.blocks
                      })}
                    </p>
                  )
                ) : (
                  <p className="text-muted-foreground">
                    {translate('missions.pendingNotBlocking', 'Not blocking')}
                  </p>
                )}
                {item.actions.length > 0 && (
                  <p className="text-muted-foreground">
                    {translate('missions.pendingYouCan', 'You can:')}{' '}
                    {item.actions.map(pendingActionLabel).join(', ')}
                  </p>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
