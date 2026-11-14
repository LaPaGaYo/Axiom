// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  mission,
  message,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type {
  MissionPendingItem,
  PendingAction
} from '../../../../shared/axiom-contract/mission-pending'
import { MissionHome } from './MissionHome'

afterEach(cleanup)
const props = {
  mission,
  goal: null,
  tasks: [taskWithSpec],
  attempts: [],
  pendingMessages: [message],
  proposedPlans: 2,
  busy: false,
  onAction: vi.fn(),
  onSelectTask: vi.fn()
}
function item(overrides: Partial<MissionPendingItem> = {}): MissionPendingItem {
  return {
    id: 'pending-1',
    kind: 'mission',
    objectId: mission.id,
    reason: 'PLANNED',
    blocking: true,
    blocks: 0,
    actions: [],
    since: '2026-11-13T12:00:00Z',
    ...overrides
  }
}
function home(pendingItems: MissionPendingItem[], pendingError = false) {
  return (
    <TooltipProvider>
      <MissionHome {...props} {...{ pendingItems, pendingError }} />
    </TooltipProvider>
  )
}
function rows() {
  const list = screen.queryByRole('list', { name: 'Pending items' })
  expect(list).not.toBeNull()
  return within(list!).getAllByRole('listitem')
}

it('lists the pending items of the Mission in the order the view returns them', () => {
  const kinds = [
    ['human_review', 'Review'],
    ['question', 'Question'],
    ['supervision_proposal', 'Supervision proposal'],
    ['mission', 'Mission'],
    ['follow_up', 'Follow-up'],
    ['task_blocked', 'Blocked Task'],
    ['stall_notice', 'Stall notice'],
    ['plan_review', 'Plan review'],
    ['subtask_request', 'Subtask request']
  ] as const
  render(home(kinds.map(([kind], i) => item({ id: String(i), kind, reason: `reason-${i}` }))))
  expect(rows()).toHaveLength(9)
  rows().forEach((row, i) => {
    expect(within(row).getByText(kinds[i][1])).toBeTruthy()
    expect(within(row).getByText(`reason-${i}`)).toBeTruthy()
  })
  expect(screen.getByRole('region', { name: 'Mission Home' }).textContent).not.toMatch(
    /done|completed/i
  )
  expect(screen.queryByText('2026-11-13T12:00:00Z')).toBeNull()
})

it('counts exactly the pending items it lists', () => {
  const { rerender } = render(home([]))
  for (const count of [0, 1, 4]) {
    rerender(home(Array.from({ length: count }, (_, i) => item({ id: String(i) }))))
    expect(screen.queryByText(`${count} pending item(s)`)).not.toBeNull()
    if (count) {
      expect(rows()).toHaveLength(count)
    } else {
      expect(screen.queryByRole('list', { name: 'Pending items' })).toBeNull()
      expect(
        within(screen.getByRole('region', { name: 'Mission Home' })).getAllByRole('button')
      ).toHaveLength(5)
    }
  }
  rerender(home([item()], true))
  expect(screen.queryByText(/\d+ pending item\(s\)/)).toBeNull()
  expect(screen.queryByRole('list', { name: 'Pending items' })).toBeNull()
  expect(screen.getByText('Pending items could not be read. Refresh to try again.')).toBeTruthy()
})

it('says why each pending item waits and how many Tasks it blocks', () => {
  render(
    home([
      item({
        kind: 'task_blocked',
        reason: 'no_eligible_provider',
        blocks: 3,
        waitingOn: { on: 'admission', reason: 'no_eligible_provider', person: true }
      }),
      item({
        id: 'budget',
        kind: 'task_blocked',
        reason: 'task_tokens',
        waitingOn: {
          on: 'budget',
          reason: 'task_tokens',
          person: true,
          budget: { scope: 'task', dimension: 'maxTokens', used: 100, limit: 100 }
        }
      }),
      item({
        id: 'question',
        kind: 'question',
        reason: 'question',
        summary: 'Which path is allowed?',
        blocking: false,
        waitingOn: { on: 'integration', reason: 'integration_queue', person: false }
      }),
      item({
        id: 'mission-budget',
        reason: 'budget_exhausted',
        waitingOn: {
          on: 'budget',
          reason: 'budget_exhausted',
          person: true,
          budget: { scope: 'mission', dimension: 'maxAttempts', used: 4, limit: 4 }
        }
      }),
      item({
        id: 'review',
        kind: 'human_review',
        reason: 'acceptance_human',
        waitingOn: { on: 'human', reason: 'acceptance_human', person: true }
      })
    ])
  )
  const [blocked, budget, question, missionBudget, review] = rows()
  expect(rows()).toHaveLength(5)
  expect(within(blocked).getByText('no_eligible_provider').className).toContain('font-mono')
  expect(
    within(blocked).getByText('No eligible provider was available at the last admission check.')
  ).toBeTruthy()
  expect(within(blocked).getByText('Blocks 3 Task(s)')).toBeTruthy()
  expect(within(budget).getByText('task_tokens').className).toContain('font-mono')
  expect(budget.textContent).toContain('The Task token budget is exhausted.')
  expect(budget.textContent).toContain('Task budget · maxTokens · 100 of 100')
  expect(budget.textContent).not.toMatch(/Blocks|Not blocking/)
  expect(question.textContent).toContain('Which path is allowed?')
  expect(within(question).getByText('Not blocking')).toBeTruthy()
  expect(question.textContent).not.toMatch(/integration_queue|integration queue|integration ·/)
  expect(missionBudget.textContent).toContain('Mission budget · maxAttempts · 4 of 4')
  expect(review.textContent).toContain('Waiting for a person to review or resolve this Task.')
})

it('names the actions the Control Plane accepts for a pending item', () => {
  const actions: [PendingAction, string][] = [
    ['axiom.task.cancel', 'Cancel Task'],
    ['axiom.mission.start', 'Start Mission'],
    ['axiom.mission.resume', 'Resume Mission'],
    ['axiom.mission.plan', 'Start Planner'],
    ['axiom.mission.cancel', 'Cancel Mission'],
    ['axiom.plan.approve', 'Approve plan'],
    ['axiom.plan.reject', 'Reject plan'],
    ['axiom.message.answer', 'Answer'],
    ['axiom.message.resolve', 'Accept or reject'],
    ['axiom.verification.resolve', 'Resolve review'],
    ['axiom.verification.rerun', 'Rerun verification'],
    ['axiom.task.adjust', 'Adjust Task'],
    ['axiom.policy.update', 'Update policy'],
    ['axiom.supervision.resolve', 'Resolve proposal']
  ]
  render(home([item({ actions: actions.map(([action]) => action) }), item({ id: 'no-actions' })]))
  const [offered, empty] = rows()
  expect(rows()).toHaveLength(2)
  const line = within(offered).getByText(/You can:/)
  expect(line.textContent).toBe(`You can: ${actions.map(([, label]) => label).join(', ')}`)
  expect(within(offered).queryAllByRole('button')).toHaveLength(0)
  expect(within(empty).queryByText(/You can:/)).toBeNull()
  expect(within(empty).queryAllByRole('button')).toHaveLength(0)
})

it('opens the Task of a pending item from Mission Home', () => {
  props.onSelectTask.mockClear()
  render(
    home([
      item({ taskId: taskWithSpec.id }),
      item({ id: 'missing', taskId: 'task-outside-list' }),
      item({ id: 'no-task' })
    ])
  )
  const [known, missing, noTask] = rows()
  expect(rows()).toHaveLength(3)
  const button = within(known).getByRole('button', { name: taskWithSpec.title })
  expect(within(known).getAllByRole('button')).toHaveLength(1)
  fireEvent.click(button)
  expect(props.onSelectTask).toHaveBeenCalledExactlyOnceWith(taskWithSpec.id)
  expect(within(missing).getByText('task-outside-list')).toBeTruthy()
  expect(within(missing).queryAllByRole('button')).toHaveLength(0)
  expect(within(noTask).queryAllByRole('button')).toHaveLength(0)
  expect(noTask.textContent).not.toContain(taskWithSpec.id)
})
