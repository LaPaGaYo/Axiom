import { useId, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { translate } from '@/i18n/i18n'
import { StallModeSchema, type StallMode } from '../../../../shared/axiom-contract/supervision'
import { stallModeGloss, stallModeLabel } from './stall-mode-copy'

export function StallModeForm({
  global,
  current,
  busy,
  onSave,
  onClose
}: {
  global: boolean
  current: StallMode | null
  busy: boolean
  onSave: (mode: StallMode | null) => Promise<void>
  onClose: () => void
}) {
  const id = useId()
  const [choice, setChoice] = useState(current ?? 'default')
  const options = global
    ? StallModeSchema.options
    : (['default', ...StallModeSchema.options] as const)
  const disabled = busy || choice === (current ?? 'default')
  const label = global
    ? translate('missions.defaultStallMode', 'Default stall mode for all Missions')
    : translate('missions.missionStallMode', 'Stall mode for this Mission')
  return (
    <form
      aria-label={label}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled) {
          void onSave(choice === 'default' ? null : StallModeSchema.parse(choice))
        }
      }}
    >
      <Label id={`${id}-label`}>{label}</Label>
      <RadioGroup
        aria-labelledby={`${id}-label`}
        value={choice}
        disabled={busy}
        onValueChange={(value) => {
          const next = options.find((option) => option === value)
          if (next) {
            setChoice(next)
          }
        }}
      >
        {options.map((mode) => (
          <div key={mode} className="flex items-start gap-2">
            <RadioGroupItem
              id={`${id}-${mode}`}
              value={mode}
              aria-label={stallModeLabel(mode)}
              aria-describedby={`${id}-${mode}-gloss`}
            />
            <Label htmlFor={`${id}-${mode}`}>
              <span className="font-mono">{stallModeLabel(mode)}</span>
            </Label>
            <span id={`${id}-${mode}-gloss`} className="text-xs text-muted-foreground">
              {mode === 'default'
                ? translate('missions.stallDefaultGloss', 'Uses the default for all Missions.')
                : stallModeGloss(mode)}
            </span>
          </div>
        ))}
      </RadioGroup>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={disabled}>
          {translate('missions.saveStallMode', 'Save stall mode')}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
