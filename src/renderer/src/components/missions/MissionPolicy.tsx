import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { MissionSummary } from '../../../../shared/axiom-contract/mission-params'
import type { Policy } from '../../../../shared/axiom-contract/mission-objects'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
import type { PolicyActions } from './policy-actions'
import { readPolicyRules } from './policy-draft'
import { MissionPolicyForm } from './MissionPolicyForm'

export function MissionPolicy({
  mission,
  policy,
  busy,
  onSave
}: {
  mission: MissionSummary
  policy: Policy | null
  busy: boolean
  onSave: PolicyActions['updatePolicy']
}) {
  useTranslation()
  const [editing, setEditing] = useState(false)
  const terminal = TERMINAL_MISSION_STATUSES.has(mission.status)
  const rules = policy ? readPolicyRules(policy) : null
  const commands = (lines?: string[]) =>
    lines?.length ? lines.join('\n') : translate('missions.policyNone', 'None')
  const values = [
    {
      key: 'concurrency',
      label: translate('missions.policyConcurrency', 'Tasks at once'),
      value: policy?.concurrencyLimit
    },
    ...(rules
      ? [
          {
            key: 'setup',
            label: translate('missions.policySetupCommands', 'Setup commands'),
            value: commands(rules.setupCommands)
          },
          {
            key: 'low',
            label: translate('missions.policyGatesLow', 'Gates for low-risk Tasks'),
            value: commands(rules.repositoryGates.low)
          },
          {
            key: 'medium',
            label: translate('missions.policyGatesMedium', 'Gates for medium-risk Tasks'),
            value: commands(rules.repositoryGates.medium)
          },
          {
            key: 'high',
            label: translate('missions.policyGatesHigh', 'Gates for high-risk Tasks'),
            value: commands(rules.repositoryGates.high)
          },
          {
            key: 'integration',
            label: translate('missions.policyIntegrationGates', 'Gates on the merged tree'),
            value:
              rules.integrationGates === undefined
                ? translate(
                    'missions.policyIntegrationDefault',
                    'Not set: the highest configured gate runs.'
                  )
                : commands(rules.integrationGates)
          },
          {
            key: 'minutes',
            label: translate('missions.policyTimeBudget', 'Verification time budget (minutes)'),
            value: rules.timeBudgetMinutes
          }
        ]
      : [])
  ]
  return (
    <section aria-labelledby="mission-policy-heading" className="space-y-3">
      <h2 id="mission-policy-heading" className="text-sm font-semibold">
        {translate('missions.policy', 'Policy')}
      </h2>
      {editing && !terminal ? (
        <MissionPolicyForm
          missionId={mission.id}
          policy={policy}
          busy={busy}
          onSave={onSave}
          onClose={() => setEditing(false)}
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
                <dd data-policy-value={key} className="whitespace-pre-wrap break-words font-mono">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {!rules && (
            <p className="text-xs text-muted-foreground">
              {translate(
                'missions.planPolicyInvalid',
                "The Mission's verification rules are not valid. Verification would end INCONCLUSIVE (policy_invalid) without running a command."
              )}
            </p>
          )}
          {!terminal && (
            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(true)}>
              {translate('missions.editPolicy', 'Edit policy')}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
