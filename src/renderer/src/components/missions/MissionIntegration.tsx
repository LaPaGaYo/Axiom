import { useTranslation } from 'react-i18next'
import { translate } from '@/i18n/i18n'
import type { MissionIntegration as MissionIntegrationView } from '../../../../shared/axiom-contract/integration-batch'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { integrationStatusLabel } from './integration-status-copy'

export function MissionIntegration({
  integration,
  tasks,
  selectedTaskId,
  onSelect
}: {
  integration?: MissionIntegrationView
  tasks: readonly TaskListItem[]
  selectedTaskId?: string | null
  onSelect: (taskId: string) => void
}) {
  useTranslation()
  const tasksWithBatch = tasks.filter((task) => task.integration)
  if (!integration && tasksWithBatch.length === 0) {
    return null
  }
  return (
    <section aria-labelledby="mission-integration-heading" className="space-y-3">
      <h2 id="mission-integration-heading" className="text-sm font-semibold">
        {translate('missions.integration', 'Integration')}
      </h2>
      {integration && (
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">
              {translate('missions.integrationBranch', 'Integration branch')}
            </dt>
            <dd className="break-all font-mono">{integration.branch}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {translate('missions.integrationRecordedHead', 'Recorded head')}
            </dt>
            <dd
              className="font-mono"
              title={integration.recordedHead}
              data-testid="integration-recorded-head"
            >
              {integration.recordedHead.slice(0, 7)}
            </dd>
          </div>
        </dl>
      )}
      {tasksWithBatch.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {translate('missions.integrationNone', 'No Task has reached integration yet.')}
        </p>
      ) : (
        <div className="overflow-x-auto scrollbar-sleek">
          <table
            className="w-full text-left text-sm"
            aria-label={translate('missions.integrationBatches', 'Integration batches')}
          >
            <thead>
              <tr className="border-b border-border">
                {[
                  translate('missions.task', 'Task'),
                  translate('missions.integrationStatus', 'Batch status'),
                  translate('missions.integrationMergeCommit', 'Merge commit'),
                  translate('missions.integrationUpdated', 'Updated')
                ].map((label) => (
                  <th key={label} className="px-3 py-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tasksWithBatch.map((task) => {
                const batch = task.integration
                if (!batch) {
                  return null
                }
                return (
                  <tr
                    key={task.id}
                    data-integration-task-id={task.id}
                    data-integration-status={batch.status}
                    aria-selected={task.id === selectedTaskId}
                    tabIndex={0}
                    className="cursor-pointer border-b border-border align-top hover:bg-accent aria-selected:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => onSelect(task.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(task.id)
                      }
                    }}
                  >
                    <td className="px-3 py-3">{task.title}</td>
                    <td className="space-y-1 px-3 py-3">
                      <p>{integrationStatusLabel(batch.status)}</p>
                      <p className="font-mono text-xs text-muted-foreground">{batch.status}</p>
                      {batch.conflicts.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          {translate(
                            'missions.integrationConflictCount',
                            '{{total}} conflicting file(s)',
                            { total: batch.conflicts.length }
                          )}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-3 font-mono" title={batch.mergeCommit ?? undefined}>
                      {batch.mergeCommit?.slice(0, 7) ?? '—'}
                    </td>
                    <td className="px-3 py-3 tabular-nums">
                      <time dateTime={batch.updatedAt}>{batch.updatedAt}</time>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
