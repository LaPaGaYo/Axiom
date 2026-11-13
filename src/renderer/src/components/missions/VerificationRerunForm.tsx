import { useId, useState } from 'react'
import type { axiomClient } from '@/lib/axiom-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'

export type RerunVerification = (
  params: Parameters<typeof axiomClient.rerunVerification>[0]
) => void | Promise<void>

export function VerificationRerunForm({
  taskId,
  busy,
  onSubmit,
  onClose
}: {
  taskId: string
  busy: boolean
  onSubmit?: RerunVerification
  onClose: () => void
}) {
  const id = useId()
  const [rationale, setRationale] = useState('')
  return (
    <form
      aria-label={translate('missions.rerunVerification', 'Rerun verification')}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && rationale.trim()) {
          void onSubmit?.({ taskId, rationale: rationale.trim() })
        }
      }}
    >
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.rerunConsequence',
          'The same Candidate is verified again; a run waiting for review is canceled.'
        )}
      </p>
      <div className="space-y-2">
        <Label htmlFor={id}>{translate('missions.rationale', 'Rationale')}</Label>
        <Textarea
          id={id}
          required
          maxLength={4000}
          disabled={busy}
          value={rationale}
          onChange={(event) => setRationale(event.target.value)}
        />
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || !rationale.trim()}>
          {translate('missions.queueRerun', 'Queue rerun')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
