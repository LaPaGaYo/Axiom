import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { Policy } from '../../../../shared/axiom-contract/mission-objects'
import type { PolicyActions } from './policy-actions'
import { POLICY_FIELDS, buildPolicyUpdate, openPolicyDraft, readPolicyRules } from './policy-draft'

export function MissionPolicyForm({
  missionId,
  policy,
  busy,
  onSave,
  onClose
}: {
  missionId: string
  policy: Policy | null
  busy: boolean
  onSave: PolicyActions['updatePolicy']
  onClose: () => void
}) {
  useTranslation()
  const id = useId()
  const [opened] = useState(() => openPolicyDraft(policy))
  const [draft, setDraft] = useState(opened)
  const editableRules = policy ? readPolicyRules(policy) !== null : opened.minutes !== ''
  const update = buildPolicyUpdate(missionId, policy, opened, draft)
  const labels = {
    concurrency: translate('missions.policyConcurrency', 'Tasks at once'),
    setup: translate('missions.policySetupCommands', 'Setup commands'),
    low: translate('missions.policyGatesLow', 'Gates for low-risk Tasks'),
    medium: translate('missions.policyGatesMedium', 'Gates for medium-risk Tasks'),
    high: translate('missions.policyGatesHigh', 'Gates for high-risk Tasks'),
    integration: translate('missions.policyIntegrationGates', 'Gates on the merged tree'),
    minutes: translate('missions.policyTimeBudget', 'Verification time budget (minutes)')
  }
  const runsHere = translate(
    'missions.policyRunsHere',
    'Setup commands and gates run on this computer when a Task is verified and when its merge is checked. A change applies to runs that start after it.'
  )
  const consequence =
    translate('missions.policySaveChanges', 'This changes: {{fields}}.', {
      fields: update.changed.map((field) => labels[field]).join(', ')
    }) + (update.changed.some((field) => field !== 'concurrency') ? ` ${runsHere}` : '')
  return (
    <form
      aria-label={translate('missions.policyFormLabel', 'Edit the policy of this Mission')}
      className="space-y-3"
      onSubmit={async (event) => {
        event.preventDefault()
        if (!busy && update.params && (await onSave(update.params, consequence))) {
          onClose()
        }
      }}
    >
      {!policy && (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.policyReadError',
            "The Mission's policy could not be read. Refresh to try again."
          )}
        </p>
      )}
      {POLICY_FIELDS.filter((field) => editableRules || field === 'concurrency').map((field) => {
        const numeric = field === 'concurrency' || field === 'minutes'
        const invalid = update.invalidNumbers.includes(field)
        return (
          <div key={field} className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-${field}`}>{labels[field]}</Label>
              {!numeric && (
                <p id={`${id}-${field}-hint`} className="text-xs text-muted-foreground">
                  {field === 'integration'
                    ? translate(
                        'missions.policyIntegrationHelp',
                        'One command per line. Leave empty to run the highest configured gate.'
                      )
                    : translate('missions.policyCommandsHelp', 'One command per line.')}
                </p>
              )}
            </div>
            {numeric ? (
              <Input
                id={`${id}-${field}`}
                type="text"
                inputMode="numeric"
                value={draft[field]}
                disabled={busy}
                aria-invalid={invalid}
                aria-describedby={invalid ? `${id}-${field}-error` : undefined}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
            ) : (
              <Textarea
                id={`${id}-${field}`}
                variant="code"
                aria-describedby={`${id}-${field}-hint`}
                value={draft[field]}
                disabled={busy}
                onChange={(event) => setDraft({ ...draft, [field]: event.target.value })}
              />
            )}
            {invalid && (
              <p id={`${id}-${field}-error`} className="text-xs text-destructive">
                {translate('missions.policyWholeNumber', 'Enter a whole number of at least 1.')}
              </p>
            )}
            {field === 'concurrency' && editableRules && (
              <p className="text-xs text-muted-foreground">{runsHere}</p>
            )}
          </div>
        )
      })}
      {!editableRules && (
        <p className="text-xs text-destructive">
          {translate(
            'missions.policyRulesNotEditable',
            'The verification rules of this Mission are not valid and cannot be edited here.'
          )}
        </p>
      )}
      {update.error && (
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
          {update.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !update.params}>
          {translate('missions.savePolicy', 'Save policy')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
