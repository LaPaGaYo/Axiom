import { vi } from 'vitest'
import type { ComponentProps } from 'react'
import {
  attempt,
  reviewPendingItem,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import { TaskDetail } from './TaskDetail'

export { TaskDetail }

export const cancelText =
  'Canceling stops the running Attempt of this Task. Its work is not integrated, and a canceled Task cannot be resumed.'
export const dependentsText = 'Tasks that depend on it wait until a person cancels them too.'
export const cancelItem: MissionPendingItem = {
  ...reviewPendingItem,
  kind: 'task_blocked',
  objectId: taskWithSpec.id,
  reason: 'upstream_canceled',
  actions: ['axiom.task.cancel']
}

export function quietCancelProps(): ComponentProps<typeof TaskDetail> {
  const task: TaskListItem = {
    ...taskWithSpec,
    waitingOn: { on: 'verification', reason: 'QUEUED', person: false }
  }
  return {
    task,
    taskSpec: taskWithSpec.spec,
    attempts: [attempt],
    messages: [],
    runs: [],
    pendingItems: [],
    busy: false,
    onAnswer: vi.fn(),
    onResolve: vi.fn(),
    onOpenWorktree: vi.fn(),
    onCancelTask: vi.fn(async () => {})
  }
}
