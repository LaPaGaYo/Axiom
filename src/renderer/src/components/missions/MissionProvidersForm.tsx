import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import type { Policy } from '../../../../shared/axiom-contract/mission-objects'
import type { PolicyActions } from './policy-actions'
import {
  buildProvidersUpdate,
  listProviders,
  openProvidersDraft,
  roleProviderUnavailable,
  type ProviderEligibility
} from './providers-draft'
import { providerLabel, providerSlotCopy } from './provider-copy'

export function MissionProvidersForm({
  missionId,
  policy,
  busy,
  providers,
  onSave,
  onClose
}: {
  missionId: string
  policy: Policy | null
  busy: boolean
  providers: readonly ProviderEligibility[] | null | undefined
  onSave: PolicyActions['updatePolicy']
  onClose: () => void
}) {
  useTranslation()
  const id = useId()
  const form = useRef<HTMLFormElement>(null)
  const [opened] = useState(() => ({
    routing: policy?.routing,
    draft: openProvidersDraft(policy?.routing)
  }))
  const [draft, setDraft] = useState(opened.draft)
  const listed = listProviders(policy?.routing ?? opened.routing, providers)
  const update = buildProvidersUpdate(missionId, policy, opened.draft, draft)
  const labels = {
    planner: translate('missions.providersPlanner', 'Planner'),
    worker: translate('missions.providersWorkers', 'Workers'),
    disallowed: translate('missions.providersAllowed', 'Allowed providers'),
    certified: translate('missions.providersCertifiedOnly', 'Only certified combinations')
  }
  const consequence = `${translate('missions.policySaveChanges', 'This changes: {{fields}}.', {
    fields: update.changed.map((field) => labels[field]).join(', ')
  })} ${translate(
    'missions.providersApplies',
    'A Planner started after this change and Worker Attempts admitted after it use the new choice. Attempts that are already running keep their provider.'
  )}`
  useEffect(() => {
    form.current?.focus({ preventScroll: true })
    form.current?.scrollIntoView?.({ block: 'nearest' })
  }, [])
  return (
    <form
      ref={form}
      tabIndex={-1}
      aria-label={translate('missions.providersFormLabel', 'Edit the providers of this Mission')}
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
      {(['planner', 'worker'] as const).map((role) => {
        const unavailable = roleProviderUnavailable(role, draft[role], providers)
        return (
          <div key={role} className="space-y-2">
            <div className="space-y-1">
              <Label htmlFor={`${id}-${role}`}>{labels[role]}</Label>
            </div>
            <Select
              value={draft[role] ?? 'automatic'}
              disabled={busy}
              onValueChange={(value) =>
                setDraft({ ...draft, [role]: value === 'automatic' ? null : value })
              }
            >
              <SelectTrigger
                id={`${id}-${role}`}
                size="sm"
                aria-describedby={unavailable ? `${id}-${role}-hint` : undefined}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="automatic">
                  {translate('missions.providersAutomatic', 'Automatic')}
                </SelectItem>
                {listed.map((provider) => (
                  <SelectItem key={provider} value={provider}>
                    {providerLabel(provider)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {unavailable && (
              <p id={`${id}-${role}-hint`} className="text-xs text-muted-foreground">
                {translate(
                  'missions.providersRoleHint',
                  'This provider is not available in every case shown in the table. Where it is not, the Control Plane chooses another eligible provider, or the Task waits when there is none.'
                )}
              </p>
            )}
          </div>
        )
      })}
      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">{labels.disallowed}</legend>
        {listed.map((provider) => (
          <div key={provider} className="flex items-center gap-2">
            <Checkbox
              id={`${id}-allow-${provider}`}
              disabled={busy}
              checked={!draft.disallowed.includes(provider)}
              onCheckedChange={(checked) =>
                setDraft({
                  ...draft,
                  disallowed: checked
                    ? draft.disallowed.filter((entry) => entry !== provider)
                    : [...draft.disallowed, provider]
                })
              }
            />
            <Label htmlFor={`${id}-allow-${provider}`}>{providerLabel(provider)}</Label>
          </div>
        ))}
      </fieldset>
      <div className="flex items-center gap-2">
        <Checkbox
          id={`${id}-certified`}
          disabled={busy}
          checked={draft.certified}
          onCheckedChange={(checked) => setDraft({ ...draft, certified: checked === true })}
        />
        <Label htmlFor={`${id}-certified`}>{labels.certified}</Label>
      </div>
      {providers === undefined ? (
        <p role="status" className="text-sm text-muted-foreground">
          {translate('missions.providersReading', 'Reading which providers can be used…')}
        </p>
      ) : providers === null ? (
        <p className="text-sm text-muted-foreground">
          {translate(
            'missions.providersUnavailable',
            'Provider availability could not be read. Only the providers named in the saved policy are listed.'
          )}
        </p>
      ) : (
        <div className="overflow-auto scrollbar-sleek">
          <table
            aria-label={translate('missions.providersTable', 'Provider availability')}
            className="w-full text-left text-sm"
          >
            <caption className="text-left text-xs text-muted-foreground">
              {translate(
                'missions.providersTableCaption',
                'Availability under the saved policy, read when this form opened. It does not change as you edit.'
              )}
            </caption>
            <thead>
              <tr>
                {[
                  translate('missions.provider', 'Provider'),
                  labels.planner,
                  translate('missions.providersWorksLow', 'Low-risk Tasks'),
                  translate('missions.providersWorksMedium', 'Medium-risk Tasks'),
                  translate('missions.providersWorksHigh', 'High-risk Tasks')
                ].map((label) => (
                  <th key={label} scope="col" className="p-2 font-medium">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {providers.map((entry) => (
                <tr
                  key={entry.provider}
                  data-provider={entry.provider}
                  className="border-t border-border"
                >
                  <th scope="row" className="p-2 align-top font-medium">
                    {providerLabel(entry.provider)}
                  </th>
                  {Object.entries({ planner: entry.planner, ...entry.worker }).map(
                    ([key, slot]) => {
                      const copy = providerSlotCopy(slot)
                      return (
                        <td key={key} className="p-2 align-top">
                          {copy.gloss ? (
                            <>
                              <span className="font-mono text-xs">{copy.value}</span> {copy.gloss}
                            </>
                          ) : (
                            copy.value
                          )}
                        </td>
                      )
                    }
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {update.error && (
        <p className="whitespace-pre-wrap break-words font-mono text-xs text-destructive">
          {update.error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !update.params}>
          {translate('missions.saveProviders', 'Save providers')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
