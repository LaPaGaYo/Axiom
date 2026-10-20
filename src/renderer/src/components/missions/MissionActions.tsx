import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  isLegalMissionTransition,
  type MissionStatus
} from '../../../../shared/axiom-contract/lifecycle'

export type MissionAction = 'plan' | 'start' | 'pause' | 'resume' | 'cancel'

export function MissionActions({
  status,
  busy,
  plannerInProgress,
  proposedPlans,
  onAction
}: {
  status: MissionStatus
  busy: boolean
  plannerInProgress: boolean
  proposedPlans: number
  onAction: (action: MissionAction) => void
}) {
  const actions = [
    {
      action: 'plan',
      label: translate('missions.startPlanner', 'Start Planner'),
      allowed: status === 'ANALYZING' && !plannerInProgress && proposedPlans === 0,
      reason: translate(
        'missions.plannerDisabled',
        'Planning requires an Analyzing Mission with no Planner in progress or proposed plan.'
      )
    },
    {
      action: 'start',
      label: translate('missions.start', 'Start Mission'),
      allowed: status === 'PLANNED',
      reason: translate(
        'missions.startDisabled',
        'Start requires an approved plan and a Planned Mission.'
      )
    },
    {
      action: 'pause',
      label: translate('missions.pause', 'Pause Mission'),
      allowed: isLegalMissionTransition(status, 'PAUSED'),
      reason: translate(
        'missions.pauseDisabled',
        'This Mission cannot be paused in its current status.'
      )
    },
    {
      action: 'resume',
      label: translate('missions.resume', 'Resume Mission'),
      allowed: status === 'PAUSED',
      reason: translate('missions.resumeDisabled', 'Only a paused Mission can be resumed.')
    },
    {
      action: 'cancel',
      label: translate('missions.cancel', 'Cancel Mission'),
      allowed: isLegalMissionTransition(status, 'CANCELED'),
      reason: translate('missions.cancelDisabled', 'A terminal Mission cannot be canceled.')
    }
  ] as const
  return (
    <div className="flex flex-wrap gap-2">
      {actions.map(({ action, label, allowed, reason }) => {
        const disabled = busy || !allowed
        return (
          <Tooltip key={action}>
            <TooltipTrigger asChild>
              <Button
                variant={
                  disabled
                    ? 'ghost'
                    : action === 'start' || action === 'plan'
                      ? 'default'
                      : action === 'cancel'
                        ? 'destructive'
                        : 'outline'
                }
                size="sm"

                aria-disabled={disabled}
                onClick={() => {
                  if (!disabled) {
                    onAction(action)
                  }
                }}
              >
                {label}
              </Button>
            </TooltipTrigger>
            {disabled && (
              <TooltipContent>
                {busy
                  ? translate('missions.actionPending', 'Waiting for the runtime response.')
                  : reason}
              </TooltipContent>
            )}
          </Tooltip>
        )
      })}
    </div>
  )
}
