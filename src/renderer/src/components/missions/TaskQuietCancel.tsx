import { useEffect, useId, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { isLegalTaskStageTransition } from '../../../../shared/axiom-contract/lifecycle'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { TaskCancelForm, type CancelTask } from './TaskCancelForm'

export function TaskQuietCancel({
  task,
  pendingItems,
  busy,
  detailRef,
  onCancelTask
}: {
  task: TaskListItem
  pendingItems?: readonly MissionPendingItem[]
  busy: boolean
  detailRef: RefObject<HTMLElement | null>
  onCancelTask?: CancelTask
}) {
  const id = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const previouslyOpen = useRef(false)
  const returnToTrigger = useRef(false)
  const [openTaskId, setOpenTaskId] = useState<string | null>(null)
  const offered =
    !!onCancelTask &&
    isLegalTaskStageTransition(task.stage, 'CANCELED') &&
    !pendingItems?.some(
      (item) => item.taskId === task.id && item.actions.includes('axiom.task.cancel')
    )
  const open = offered && openTaskId === task.id
  // Discard the selection before a different Task or a removed action can keep its form.
  if (openTaskId && !open) {
    setOpenTaskId(null)
  }
  useEffect(() => {
    if (open) {
      form.current?.querySelector('textarea')?.focus()
    } else if (previouslyOpen.current) {
      detailRef.current?.focus({ preventScroll: true })
    }
    previouslyOpen.current = open
  }, [open, detailRef])
  useEffect(() => {
    if (!open && returnToTrigger.current && !busy) {
      returnToTrigger.current = false
      if (trigger.current?.isConnected && !trigger.current.disabled) {
        trigger.current.focus({ preventScroll: true })
      } else {
        detailRef.current?.focus({ preventScroll: true })
      }
    }
  }, [open, busy, detailRef])
  if (!offered) {
    return null
  }
  return (
    <div className="space-y-3">
      <Button
        ref={trigger}
        type="button"
        variant="ghost"
        size="sm"
        disabled={busy}
        aria-expanded={open}
        aria-controls={open ? `${id}-form` : undefined}
        onClick={() => {
          returnToTrigger.current = false
          setOpenTaskId(task.id)
        }}
      >
        {translate('missions.cancelTask', 'Cancel Task')}
      </Button>
      {open && (
        <div id={`${id}-form`} ref={form}>
          <TaskCancelForm
            taskId={task.id}
            busy={busy}
            onSubmit={onCancelTask}
            onClose={() => {
              previouslyOpen.current = false
              returnToTrigger.current = true
              setOpenTaskId(null)
            }}
          />
        </div>
      )}
    </div>
  )
}
