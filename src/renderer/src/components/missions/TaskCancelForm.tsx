import { useId, useState } from 'react'
import type { axiomClient } from '@/lib/axiom-client'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'

export type CancelTask = (
  params: Parameters<typeof axiomClient.cancelTask>[0],
  consequence: string
) => void | Promise<void>

export function TaskCancelForm({
  taskId,
  item,
  busy,
  onSubmit,
  onClose
}: {
  taskId: string
  item?: MissionPendingItem
  busy: boolean
  onSubmit?: CancelTask
  onClose: () => void
}) {
  const id = useId()
  const [rationale, setRationale] = useState('')
  const consequence = translate(
    'missions.cancelTaskConsequence',
    'Canceling stops the running Attempt of this Task. Its work is not integrated, and a canceled Task cannot be resumed.'
  )
  const dependents = !item?.blocking
    ? translate(
        'missions.cancelTaskDependentsUnknown',
        'Tasks that depend on it wait until a person cancels them too.'
      )
    : item.blocks > 1
      ? translate(
          'missions.cancelTaskDependents',
          'Tasks that depend on it: {{count}}. They wait until a person cancels them too.',
          { count: item.blocks - 1 }
        )
      : null
  return (
    <form
      aria-label={translate('missions.cancelTask', 'Cancel Task')}
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (!busy && rationale.trim()) {
          void onSubmit?.(
            { taskId, rationale: rationale.trim() },
            [consequence, dependents].filter(Boolean).join(' ')
          )
        }
      }}
    >
      <p className="text-xs text-muted-foreground">{consequence}</p>
      {dependents && <p className="text-xs text-muted-foreground">{dependents}</p>}
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
        <Button type="submit" variant="destructive" disabled={busy || !rationale.trim()}>
          {translate('missions.cancelTask', 'Cancel Task')}
        </Button>
        <Button type="button" variant="ghost" onClick={onClose}>
          {translate('missions.close', 'Close')}
        </Button>
      </div>
    </form>
  )
}
