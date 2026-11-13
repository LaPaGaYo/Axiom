import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import type { TaskEvidenceReads } from './task-evidence-read'
import { VerificationResolveForm, type ResolveVerification } from './VerificationResolveForm'
import { VerificationRerunForm, type RerunVerification } from './VerificationRerunForm'

export type TaskVerificationActionProps = {
  onResolveVerification?: ResolveVerification
  onRerunVerification?: RerunVerification
}
type OfferedAction = {
  method: 'axiom.verification.resolve' | 'axiom.verification.rerun'
  objectId: string
}

export function TaskVerificationActions({
  task,
  pendingItems,
  pendingError,
  runs,
  busy,
  detailRef,
  onResolveVerification,
  onRerunVerification
}: TaskEvidenceReads &
  TaskVerificationActionProps & {
    task: TaskListItem
    busy: boolean
    detailRef: RefObject<HTMLElement | null>
  }) {
  const id = useId()
  const [open, setOpen] = useState<OfferedAction | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const form = useRef<HTMLDivElement>(null)
  const previouslyOpen = useRef(false)
  const offered: OfferedAction[] = []
  for (const item of pendingItems ?? []) {
    if (item.taskId !== task.id) {
      continue
    }
    for (const method of item.actions) {
      if (
        (method === 'axiom.verification.resolve' || method === 'axiom.verification.rerun') &&
        !offered.some((action) => action.method === method)
      ) {
        offered.push({ method, objectId: item.objectId })
      }
    }
  }
  const current =
    open &&
    offered.find((action) => action.method === open.method && action.objectId === open.objectId)
  // Invalidate the local selection before committing a refresh that removed its action.
  if (open && !current) {
    setOpen(null)
  }
  useEffect(() => {
    if (open) {
      form.current?.querySelector<HTMLElement>('[role="radio"], textarea, button')?.focus()
    } else if (previouslyOpen.current) {
      detailRef.current?.focus({ preventScroll: true })
    }
    previouslyOpen.current = !!open
  }, [open, detailRef])
  const close = () => {
    previouslyOpen.current = false
    setOpen(null)
    trigger.current?.focus({ preventScroll: true })
  }
  if (!offered.length) {
    return pendingError && task.waitingOn?.person ? (
      <p className="text-xs text-muted-foreground">
        {translate(
          'missions.taskActionsReadError',
          'Actions could not be read. Refresh to try again.'
        )}
      </p>
    ) : null
  }
  const run = runs?.find((entry) => entry.id === current?.objectId)
  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-3">
      <h3 id={`${id}-heading`} className="text-sm font-medium">
        {translate('missions.taskActions', 'Task actions')}
      </h3>
      <div className="flex flex-wrap gap-2">
        {offered.map((action) => (
          <Button
            key={action.method}
            type="button"
            variant="outline"
            size="sm"
            disabled={busy}
            aria-expanded={current?.method === action.method}
            aria-controls={current?.method === action.method ? `${id}-form` : undefined}
            onClick={(event) => {
              trigger.current = event.currentTarget
              setOpen(action)
            }}
          >
            {action.method === 'axiom.verification.resolve'
              ? translate('missions.resolveReview', 'Resolve review')
              : translate('missions.rerunVerification', 'Rerun verification')}
          </Button>
        ))}
      </div>
      {current && (
        <div id={`${id}-form`} ref={form}>
          {current.method === 'axiom.verification.rerun' ? (
            <VerificationRerunForm
              key={current.objectId}
              taskId={task.id}
              busy={busy}
              onSubmit={onRerunVerification}
              onClose={close}
            />
          ) : run ? (
            <VerificationResolveForm
              key={run.id}
              run={run}
              busy={busy}
              onSubmit={onResolveVerification}
              onClose={close}
            />
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {translate(
                  'missions.reviewRunReadError',
                  'The run could not be read. Refresh to try again.'
                )}
              </p>
              <Button type="button" variant="ghost" onClick={close}>
                {translate('missions.close', 'Close')}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
