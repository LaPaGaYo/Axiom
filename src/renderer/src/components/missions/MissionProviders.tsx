import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import type { Policy, RoleRouting } from '../../../../shared/axiom-contract/mission-objects'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import type { PolicyActions } from './policy-actions'
import type { ProviderEligibility } from './providers-draft'
import { providerLabel } from './provider-copy'
import { MissionProvidersForm } from './MissionProvidersForm'

export type ProvidersRequest = {
  missionId: string
  providers: ProviderEligibility[] | null | undefined
}

export function MissionProviders({
  mission,
  policy,
  busy,
  request,
  onEdit,
  onClose,
  onSave
}: {
  mission: MissionSummary
  policy: Policy | null
  busy: boolean
  request?: ProvidersRequest | null
  onEdit: () => void
  onClose: () => void
  onSave: PolicyActions['updatePolicy']
}) {
  useTranslation()
  const terminal = TERMINAL_MISSION_STATUSES.has(mission.status)
  const roleValue = (role?: RoleRouting) =>
    [
      role?.provider
        ? providerLabel(role.provider)
        : translate('missions.providersAutomatic', 'Automatic'),
      ...(role?.model !== undefined
        ? [translate('missions.providersModel', 'model {{model}}', { model: role.model })]
        : []),
      ...(role?.effort !== undefined
        ? [translate('missions.providersEffort', 'effort {{effort}}', { effort: role.effort })]
        : [])
    ].join(' · ')
  const routing = policy?.routing
  const values = [
    {
      key: 'planner',
      label: translate('missions.providersPlanner', 'Planner'),
      value: roleValue(routing?.roles.planner)
    },
    {
      key: 'worker',
      label: translate('missions.providersWorkers', 'Workers'),
      value: roleValue(routing?.roles.worker)
    },
    {
      key: 'disallowed',
      label: translate('missions.providersDisallowed', 'Providers not allowed'),
      value: routing?.disallowedProviders.length
        ? routing.disallowedProviders.map(providerLabel).join(', ')
        : translate('missions.policyNone', 'None')
    },
    {
      key: 'certified',
      label: translate('missions.providersCertifiedOnly', 'Only certified combinations'),
      value: routing?.requireCertified
        ? translate('missions.providersYes', 'Yes')
        : translate('missions.providersNo', 'No')
    }
  ]
  return (
    <section aria-labelledby="mission-providers-heading" className="space-y-3">
      <h2 id="mission-providers-heading" className="text-sm font-semibold">
        {translate('missions.providers', 'Providers')}
      </h2>
      {request && !terminal ? (
        <MissionProvidersForm
          missionId={mission.id}
          policy={policy}
          busy={busy}
          providers={request.providers}
          onSave={onSave}
          onClose={onClose}
        />
      ) : !policy ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.policyReadError',
            "The Mission's policy could not be read. Refresh to try again."
          )}
        </p>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            {values.map(({ key, label, value }) => (
              <div key={key}>
                <dt className="text-muted-foreground">{label}</dt>
                <dd data-providers-value={key} className="whitespace-pre-wrap break-words">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {!terminal && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={onEdit}>
              {translate('missions.editProviders', 'Edit providers')}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
