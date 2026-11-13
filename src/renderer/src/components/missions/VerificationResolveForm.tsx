import { useId, useState } from 'react'
import type { axiomClient } from '@/lib/axiom-client'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import {
  allowedVerificationDispositions,
  type VerificationDisposition
} from '../../../../shared/axiom-contract/verification-disposition'
import { verificationDispositionGloss } from './verification-disposition-copy'

export type ResolveVerification = (
  params: Parameters<typeof axiomClient.resolveVerification>[0]
) => void | Promise<void>

export function VerificationResolveForm({
  run,
  busy,
  onSubmit,
  onClose
}: {
  run: VerificationRunView
  busy: boolean
  onSubmit?: ResolveVerification
  onClose: () => void
}) {
  const id = useId()
  const record = readVerdictRecord(run.verdictDetail)
  const [verdict, setVerdict] = useState<'PASS' | 'FAIL'>()
  const [disposition, setDisposition] = useState<VerificationDisposition>()
  const [criteria, setCriteria] = useState<number[]>([])
  const [rationale, setRationale] = useState('')
  const allowed = verdict ? allowedVerificationDispositions(verdict, record.reason) : []
  const selected = allowed.length === 1 ? allowed[0] : disposition
  const disabled =
    busy ||
    !verdict ||
    !rationale.trim() ||
    (allowed.length > 0 && (!selected || !allowed.includes(selected)))
  return (
    <form
      aria-label={translate('missions.resolveReview', 'Resolve review')}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled || !verdict) {
          return
        }
        void onSubmit?.({
          runId: run.id,
          verdict,
          rationale: rationale.trim(),
          criteria: criteria.toSorted((a, b) => a - b),
          ...(allowed.length && selected ? { disposition: selected } : {})
        })
      }}
    >
      <p className="break-all text-xs">
        {translate('missions.waitingVerificationRun', 'Verification run')}:{' '}
        <span className="font-mono">{run.id}</span>
        {record.reason && (
          <>
            {' '}
            · <span className="font-mono">{record.reason}</span>
          </>
        )}
      </p>
      <div className="space-y-2">
        <Label id={`${id}-verdict`}>{translate('missions.verdict', 'Verdict')}</Label>
        <RadioGroup
          aria-labelledby={`${id}-verdict`}
          value={verdict ?? ''}
          disabled={busy}
          onValueChange={(value) => {
            if (value !== 'PASS' && value !== 'FAIL') {
              return
            }
            setVerdict(value)
            if (
              disposition &&
              !allowedVerificationDispositions(value, record.reason).includes(disposition)
            ) {
              setDisposition(undefined)
            }
          }}
        >
          {(['PASS', 'FAIL'] as const).map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-${value}`} value={value} aria-label={value} />
              <Label htmlFor={`${id}-${value}`}>
                <span className="font-mono">{value}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {verdict && (
          <p className="text-xs text-muted-foreground">
            {verdict === 'PASS'
              ? translate(
                  'missions.resolvePassConsequence',
                  'The Task becomes VERIFIED and waits for integration; a resolved run cannot be resolved again.'
                )
              : translate(
                  'missions.resolveFailConsequence',
                  'The Task goes back to be fixed and the next Attempt is told the rationale; a resolved run cannot be resolved again.'
                )}
          </p>
        )}
      </div>
      {allowed.length > 0 && (
        <div className="space-y-2">
          <Label id={`${id}-disposition`}>{translate('missions.disposition', 'Disposition')}</Label>
          {allowed.length === 1 ? (
            <p className="text-xs">
              <span className="font-mono">{allowed[0]}</span> ·{' '}
              <span>{verificationDispositionGloss(allowed[0])}</span>
            </p>
          ) : (
            <RadioGroup
              aria-labelledby={`${id}-disposition`}
              value={disposition ?? ''}
              disabled={busy}
              onValueChange={(value) => setDisposition(allowed.find((entry) => entry === value))}
            >
              {allowed.map((value) => (
                <div key={value} className="flex items-center gap-2">
                  <RadioGroupItem
                    id={`${id}-${value}`}
                    value={value}
                    aria-label={value}
                    aria-describedby={`${id}-${value}-gloss`}
                  />
                  <Label htmlFor={`${id}-${value}`}>
                    <span className="font-mono">{value}</span>
                  </Label>
                  <span id={`${id}-${value}-gloss`} className="text-xs text-muted-foreground">
                    {verificationDispositionGloss(value)}
                  </span>
                </div>
              ))}
            </RadioGroup>
          )}
        </div>
      )}
      {record.acceptance.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">
            {translate('missions.resolvedCriteria', 'Criteria named in the resolution')}
          </legend>
          {verdict && (
            <p className="text-xs text-muted-foreground">
              {verdict === 'FAIL'
                ? translate(
                    'missions.resolveFailedCriteria',
                    'The next Attempt is told the ticked criteria failed.'
                  )
                : translate(
                    'missions.resolveRecordedCriteria',
                    'The ticked criteria are recorded with the resolution.'
                  )}
            </p>
          )}
          {record.acceptance.map((criterion, position) => (
            <div key={`${criterion.index}:${position}`} className="flex items-start gap-2">
              <Checkbox
                id={`${id}-criterion-${position}`}
                disabled={busy}
                checked={criteria.includes(criterion.index)}
                onCheckedChange={(checked) =>
                  setCriteria((current) =>
                    checked === true
                      ? [...new Set([...current, criterion.index])]
                      : current.filter((index) => index !== criterion.index)
                  )
                }
              />
              <Label htmlFor={`${id}-criterion-${position}`} className="whitespace-pre-wrap">
                #{criterion.index} · {criterion.text}
              </Label>
            </div>
          ))}
        </fieldset>
      )}
      <div className="space-y-2">
        <Label htmlFor={`${id}-rationale`}>{translate('missions.rationale', 'Rationale')}</Label>
        <Textarea
          id={`${id}-rationale`}
          required
          maxLength={4000}
          value={rationale}
          disabled={busy}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={disabled}>
          {translate('missions.submitResolution', 'Submit resolution')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
