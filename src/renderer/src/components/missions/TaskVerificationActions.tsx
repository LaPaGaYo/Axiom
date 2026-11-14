import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject, ComponentProps } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import type { TaskEvidenceReads } from './task-evidence-read'
import { VerificationResolveForm, type ResolveVerification } from './VerificationResolveForm'
import { VerificationRerunForm, type RerunVerification } from './VerificationRerunForm'
import { TaskAdjustForm, type AdjustTask } from './TaskAdjustForm'
import { TaskCancelForm, type CancelTask } from './TaskCancelForm'
import type { MessageTimeline } from './MessageTimeline'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'

export type TaskVerificationActionProps = {
  onResolveVerification?: ResolveVerification
  onRerunVerification?: RerunVerification
  onAdjustTask?: AdjustTask
  onCancelTask?: CancelTask
}
type OfferedAction = {
  method:
    | 'axiom.verification.resolve'
    | 'axiom.verification.rerun'
    | 'axiom.task.adjust'
    | 'axiom.task.cancel'
  objectId: string
  item: MissionPendingItem
}

export function TaskVerificationActions({
  task,
  pendingItems,
  pendingError,
  runs,
  busy,
  detailRef,
  onResolveVerification,
  onRerunVerification,
  taskSpec,
  messages,
  onAdjustTask,
  onCancelTask
}: TaskEvidenceReads &
  TaskVerificationActionProps & {
    task: TaskListItem
    busy: boolean
    detailRef: RefObject<HTMLElement | null>
    messages?: ComponentProps<typeof MessageTimeline>['messages']
  }) {
  const id = useId()
  const [open, setOpen] = useState<OfferedAction | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const form = useRef<HTMLDivElement>(null)
  const previouslyOpen = useRef(false)
  const returnToTrigger = useRef(false)
  const offered: OfferedAction[] = []
  for (const item of pendingItems ?? []) {
    if (item.taskId !== task.id) {
      continue
    }
    for (const method of item.actions) {
      if (
        (method === 'axiom.verification.resolve' ||
          method === 'axiom.verification.rerun' ||
          method === 'axiom.task.adjust' ||
          method === 'axiom.task.cancel') &&
        !offered.some((action) => action.method === method)
      ) {
        offered.push({ method, objectId: item.objectId, item })
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
  useEffect(() => {
    // A late result must not steal focus from a newly opened form.
    if (!open && returnToTrigger.current && !busy) {
      returnToTrigger.current = false
      const target = trigger.current
      if (target?.isConnected && !target.disabled) {
        target.focus({ preventScroll: true })
      } else {
        detailRef.current?.focus({ preventScroll: true })
      }
    }
  }, [open, busy, detailRef])
  const close = () => {
    previouslyOpen.current = false
    returnToTrigger.current = true
    setOpen(null)
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
  const initialPaths =
    current?.item.kind === 'task_blocked' && current.item.reason === 'scope'
      ? (messages
          ?.find(
            (message) =>
              message.taskId === task.id &&
              message.pending &&
              message.type === 'BLOCKED' &&
              message.blocked?.reason === 'blocked_by_scope'
          )
          ?.blocked?.paths.join('\n') ?? '')
      : ''
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
              : action.method === 'axiom.verification.rerun'
                ? translate('missions.rerunVerification', 'Rerun verification')
                : action.method === 'axiom.task.adjust'
                  ? translate('missions.adjustTask', 'Adjust Task')
                  : translate('missions.cancelTask', 'Cancel Task')}
          </Button>
        ))}
      </div>
      {current && (
        <div id={`${id}-form`} ref={form}>
          {current.method === 'axiom.task.cancel' ? (
            <TaskCancelForm
              key={current.objectId}
              taskId={task.id}
              item={current.item}
              busy={busy}
              onSubmit={onCancelTask}
              onClose={close}
            />
          ) : current.method === 'axiom.task.adjust' ? (
            taskSpec ? (
              <TaskAdjustForm
                key={current.objectId}
                taskId={task.id}
                spec={taskSpec}
                item={current.item}
                initialPaths={initialPaths}
                busy={busy}
                onSubmit={onAdjustTask}
                onClose={close}
              />
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  {translate(
                    'missions.taskSpecReadError',
                    'The Task could not be read. Refresh to try again.'
                  )}
                </p>
                <Button type="button" variant="ghost" onClick={close}>
                  {translate('missions.close', 'Close')}
                </Button>
              </div>
            )
          ) : current.method === 'axiom.verification.rerun' ? (
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
