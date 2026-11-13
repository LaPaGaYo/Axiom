import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { TaskStageBadge } from './TaskStageBadge'
import { verificationTone } from './VerificationStatus'

export function TaskEvidenceStage({
  task,
  latest,
  failed,
  onOpen
}: {
  task: TaskListItem
  latest?: VerificationRunView
  failed?: boolean
  onOpen: (id?: string) => void
}) {
  if (task.stage !== 'VERIFIED' && task.stage !== 'INTEGRATED') {
    return <TaskStageBadge stage={task.stage} orcaStatus={task.orcaStatus} />
  }
  const hasEvidence = !failed && latest?.status === 'PASS'
  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        data-task-stage={task.stage}
        onClick={() => onOpen(latest?.id)}
      >
        <span className={hasEvidence ? verificationTone('PASS') : 'text-muted-foreground'}>
          {task.stage === 'VERIFIED'
            ? translate('missions.stages.VERIFIED', 'Verified')
            : translate('missions.stages.INTEGRATED', 'Integrated')}
        </span>
      </Button>
      {!hasEvidence && (
        <p className="text-xs text-muted-foreground">
          {failed
            ? translate(
                'missions.verificationReadFailed',
                'Verification could not be read. Refresh to try again.'
              )
            : translate('missions.passingRecordMissing', 'Passing verification record missing.')}
        </p>
      )}
      {task.orcaStatus && (
        <p className="text-xs text-muted-foreground">
          {translate('missions.executionProjection', 'Execution projection')}:{' '}
          {task.orcaStatus === 'completed'
            ? translate('missions.attemptSettled', 'Attempt settled')
            : task.orcaStatus}
        </p>
      )}
    </div>
  )
}
