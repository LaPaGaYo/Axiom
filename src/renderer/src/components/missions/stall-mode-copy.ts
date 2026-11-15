import { translate } from '@/i18n/i18n'
import type { StallMode } from '../../../../shared/axiom-contract/supervision'

export function stallModeLabel(mode: StallMode | 'default') {
  return mode === 'default' ? translate('missions.stallDefaultValue', 'default') : mode
}

export function stallModeGloss(mode: StallMode) {
  const glosses: Record<StallMode, string> = {
    observe: translate(
      'missions.stallObserveGloss',
      'Records a headless Worker that is silent past the stall threshold in the audit; the Worker keeps running.'
    ),
    notify: translate(
      'missions.stallNotifyGloss',
      'Records the stall and adds a pending notice; the headless Worker keeps running.'
    ),
    stop: translate(
      'missions.stallStopGloss',
      'Stops a stalled headless Worker. After the host confirms the stop, available work is kept and the Task retries; each stop uses an attempt, and a Task out of attempts is blocked.'
    )
  }
  return glosses[mode]
}

export function stallStopConsequence(global: boolean) {
  return global
    ? translate(
        'missions.stopDefaultStallConsequence',
        'From the next supervision pass, a silent headless Worker of any Mission without its own setting is stopped without asking. Once the stop is confirmed, its work is kept and the Task tries again. Every stop uses one of the Task’s attempts. A Task that runs out of attempts is blocked until you act.'
      )
    : translate(
        'missions.stopMissionStallConsequence',
        'From the next supervision pass, a silent headless Worker of this Mission is stopped without asking. Once the stop is confirmed, its work is kept and the Task tries again. Every stop uses one of the Task’s attempts. A Task that runs out of attempts is blocked until you act.'
      )
}
