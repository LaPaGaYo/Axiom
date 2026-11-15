import { useId } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { ArtifactKind } from '../../../../shared/axiom-contract/mission-objects'
import type { CriterionDraft, CriterionIssue } from './use-task-criteria-draft'

export function TaskCriterionFields({
  row,
  number,
  issues,
  busy,
  onChange,
  onRemove
}: {
  row: CriterionDraft
  number: number
  issues: CriterionIssue[]
  busy: boolean
  onChange: (change: Partial<Omit<CriterionDraft, 'key'>>) => void
  onRemove: () => void
}) {
  const id = useId()
  const textError = issues
    .filter(({ path }) => path[1] === 'text')
    .map(({ message }) => message)
    .join(' ')
  const commandError = issues
    .filter(({ path }) => path[1] === 'check' && path[2] === 'command')
    .map(({ message }) => message)
    .join(' ')
  return (
    <li
      aria-label={translate('missions.criterionRow', 'Criterion {{number}}', { number })}
      className="space-y-3"
    >
      <div className="space-y-2">
        <Label htmlFor={`${id}-text`}>
          {translate('missions.criterionText', 'Text of criterion {{number}}', { number })}
        </Label>
        <Textarea
          id={`${id}-text`}
          value={row.text}
          disabled={busy}
          aria-invalid={!!textError}
          aria-describedby={textError ? `${id}-text-error` : undefined}
          onChange={(event) => onChange({ text: event.target.value })}
        />
        {textError && (
          <p id={`${id}-text-error`} className="text-xs text-destructive">
            {textError}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label id={`${id}-proof`}>
          {translate('missions.criterionProofChoice', 'Proof of criterion {{number}}', { number })}
        </Label>
        <RadioGroup
          aria-labelledby={`${id}-proof`}
          value={row.kind}
          disabled={busy}
          onValueChange={(kind) => {
            if (kind === 'command' || kind === 'artifact' || kind === 'human') {
              onChange({ kind })
            }
          }}
        >
          {(['command', 'artifact', 'human'] as const).map((kind) => (
            <div key={kind} className="flex items-center gap-2">
              <RadioGroupItem id={`${id}-proof-${kind}`} value={kind} aria-label={kind} />
              <Label htmlFor={`${id}-proof-${kind}`}>
                <span className="font-mono">{kind}</span>
              </Label>
            </div>
          ))}
        </RadioGroup>
      </div>
      {row.kind === 'command' && (
        <div className="space-y-2">
          <Label htmlFor={`${id}-command`}>
            {translate('missions.criterionCommand', 'Command of criterion {{number}}', { number })}
          </Label>
          <div className="font-mono">
            <Input
              id={`${id}-command`}
              value={row.command}
              disabled={busy}
              aria-invalid={!!commandError}
              aria-describedby={commandError ? `${id}-command-error` : undefined}
              onChange={(event) => onChange({ command: event.target.value })}
            />
          </div>
          {commandError && (
            <p id={`${id}-command-error`} className="text-xs text-destructive">
              {commandError}
            </p>
          )}
        </div>
      )}
      {row.kind === 'artifact' && (
        <div className="space-y-2">
          <Label id={`${id}-artifact-kind`}>
            {translate('missions.criterionArtifactKind', 'Artifact kind of criterion {{number}}', {
              number
            })}
          </Label>
          <RadioGroup
            aria-labelledby={`${id}-artifact-kind`}
            value={row.artifactKind ?? ''}
            disabled={busy}
            onValueChange={(value) => {
              const parsed = ArtifactKind.safeParse(value)
              if (value === '' || parsed.success) {
                onChange({ artifactKind: parsed.success ? parsed.data : undefined })
              }
            }}
          >
            <div className="flex items-center gap-2">
              <RadioGroupItem
                id={`${id}-any`}
                value=""
                aria-label={translate('missions.criterionAnyKind', 'Any kind')}
              />
              <Label htmlFor={`${id}-any`}>
                {translate('missions.criterionAnyKind', 'Any kind')}
              </Label>
            </div>
            {ArtifactKind.options.map((kind) => (
              <div key={kind} className="flex items-center gap-2">
                <RadioGroupItem id={`${id}-artifact-${kind}`} value={kind} aria-label={kind} />
                <Label htmlFor={`${id}-artifact-${kind}`}>
                  <span className="font-mono">{kind}</span>
                </Label>
              </div>
            ))}
          </RadioGroup>
        </div>
      )}
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRemove}>
        {translate('missions.removeCriterion', 'Remove criterion {{number}}', { number })}
      </Button>
    </li>
  )
}
