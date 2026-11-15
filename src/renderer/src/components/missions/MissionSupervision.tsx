import { useId, useState } from 'react'
import type { z } from 'zod'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import type { SupervisionShowResponse } from '../../../../shared/axiom-contract/supervision'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import type { SupervisionActions } from './supervision-actions'
import { stallModeGloss, stallModeLabel } from './stall-mode-copy'
import { StallModeForm } from './StallModeForm'
import { SupervisionProposal } from './SupervisionProposal'

export function MissionSupervision({
  mission,
  supervision,
  pendingItems,
  pendingError,
  busy,
  onUpdate,
  onResolve
}: {
  mission: MissionSummary
  supervision: z.infer<typeof SupervisionShowResponse> | null
  pendingItems: MissionPendingItem[]
  pendingError: boolean
  busy: boolean
  onUpdate: SupervisionActions['updateSupervision']
  onResolve: SupervisionActions['resolveSupervision']
}) {
  const id = useId()
  const [scope, setScope] = useState<'mission' | 'global' | null>(null)
  const rule = supervision?.rules[0]
  const terminal = TERMINAL_MISSION_STATUSES.has(mission.status)
  const proposal = supervision?.proposals.find((entry) => entry.status === 'OPEN')
  const sources = {
    built_in: translate('missions.stallSourceBuiltIn', 'built in'),
    user: translate('missions.stallSourceUser', 'set by you'),
    proposal: translate('missions.stallSourceProposal', 'from an accepted proposal')
  }
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="text-sm font-semibold">
        {translate('missions.supervision', 'Supervision')}
      </h2>
      {!rule || !rule.effectiveMode || rule.missionMode === undefined ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.supervisionReadError',
            'Supervision settings could not be read. Refresh to try again.'
          )}
        </p>
      ) : (
        <>
          <h3 className="text-sm font-medium">
            {translate('missions.stalledWorkers', 'Stalled Workers')}
          </h3>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {translate('missions.effectiveStallMode', 'In effect for this Mission')}
              </dt>
              <dd>
                <span className="font-mono">{rule.effectiveMode}</span> ·{' '}
                {stallModeGloss(rule.effectiveMode)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {translate('missions.missionStallSetting', "This Mission's setting")}
              </dt>
              <dd className="font-mono">{stallModeLabel(rule.missionMode ?? 'default')}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {translate('missions.globalStallSetting', 'Default for all Missions')}
              </dt>
              <dd>
                <span className="font-mono">{rule.globalMode}</span> · {sources[rule.globalSource]}
              </dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            {!terminal && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => setScope('mission')}>
                {translate('missions.changeMissionStallMode', 'Change for this Mission')}
              </Button>
            )}
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setScope('global')}>
              {translate('missions.changeDefaultStallMode', 'Change the default')}
            </Button>
          </div>
          {scope && (scope === 'global' || !terminal) && (
            <StallModeForm
              key={scope}
              global={scope === 'global'}
              current={scope === 'global' ? rule.globalMode : rule.missionMode}
              busy={busy}
              onClose={() => setScope(null)}
              onSave={async (mode) => {
                if (
                  await onUpdate({
                    rule: rule.rule,
                    ...(scope === 'mission' ? { missionId: mission.id } : {}),
                    mode
                  })
                ) {
                  setScope(null)
                }
              }}
            />
          )}
          {proposal && (
            <SupervisionProposal
              proposal={proposal}
              canAnswer={
                !pendingError &&
                pendingItems.some(
                  (item) =>
                    item.kind === 'supervision_proposal' &&
                    item.objectId === proposal.id &&
                    item.actions.includes('axiom.supervision.resolve')
                )
              }
              busy={busy}
              onResolve={onResolve}
            />
          )}
        </>
      )}
    </section>
  )
}
