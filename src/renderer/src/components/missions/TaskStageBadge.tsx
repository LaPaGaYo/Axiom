import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { translate } from '@/i18n/i18n'
import { TASK_STAGE_LABELS } from '../../../../shared/axiom-contract/stage-labels'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'

export function TaskStageBadge({
  stage,
  orcaStatus
}: Pick<TaskListItem, 'stage'> & Partial<Pick<TaskListItem, 'orcaStatus'>>) {
  useTranslation()
  return (
    <div className="space-y-1">
      <Badge variant="outline" data-task-stage={stage}>
        {translate(`missions.stages.${stage}`, TASK_STAGE_LABELS[stage].en)}
      </Badge>
      {orcaStatus && (
        <div className="text-xs text-muted-foreground">
          {translate('missions.executionProjection', 'Execution projection')}:{' '}
          {orcaStatus === 'completed'
            ? translate('missions.attemptSettled', 'Attempt settled')
            : orcaStatus}
        </div>
      )}
    </div>
  )
}
