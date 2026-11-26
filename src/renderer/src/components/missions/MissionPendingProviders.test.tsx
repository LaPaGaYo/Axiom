// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { TooltipProvider } from '@/components/ui/tooltip'
import { mission } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import { MissionPendingList } from './MissionPendingList'
import { MissionHome } from './MissionHome'

const items: MissionPendingItem[] = [
  {
    id: 'provider-wait',
    kind: 'task_blocked',
    objectId: 'task-1',
    taskId: 'task-1',
    reason: 'no_eligible_provider',
    blocking: true,
    blocks: 0,
    actions: ['axiom.policy.update', 'axiom.task.cancel'],
    since: '2026-11-24T12:00:00Z'
  },
  {
    id: 'other-wait',
    kind: 'task_blocked',
    objectId: 'task-2',
    taskId: 'task-2',
    reason: 'budget_exhausted',
    blocking: true,
    blocks: 0,
    actions: ['axiom.task.cancel'],
    since: '2026-11-24T12:00:00Z'
  }
]
const props = { items, tasks: [], onSelectTask: vi.fn() }
afterEach(cleanup)

it('offers the provider editor on a pending item that allows a policy update', () => {
  const onEditProviders = vi.fn()
  render(<MissionPendingList {...props} onEditProviders={onEditProviders} />)
  const rows = within(screen.getByRole('list', { name: 'Pending items' })).getAllByRole('listitem')
  const actionLine = within(rows[0]).getByText('You can: Update policy, Cancel Task')
  const button = within(rows[0]).getByRole('button', { name: 'Edit providers' })
  expect(within(rows[0]).getByText(/^Since/).nextElementSibling).toBe(actionLine)
  expect(actionLine.nextElementSibling).toBe(button)
  expect(within(rows[1]).queryByRole('button')).toBeNull()
  expect(screen.getAllByRole('button', { name: 'Edit providers' })).toHaveLength(1)
  fireEvent.click(button)
  expect(onEditProviders).toHaveBeenCalledTimes(1)
})

it('offers no provider editor without a callback', () => {
  render(<MissionPendingList {...props} />)
  expect(screen.queryByRole('button')).toBeNull()
  expect(screen.getByText('You can: Update policy, Cancel Task')).toBeTruthy()
  expect(screen.getByText('You can: Cancel Task')).toBeTruthy()
})

it('passes the provider editor callback from Mission Home to the pending list', () => {
  const onEditProviders = vi.fn()
  render(
    <TooltipProvider>
      <MissionHome
        mission={mission}
        goal={null}
        tasks={[]}
        attempts={[]}
        pendingItems={items}
        proposedPlans={0}
        busy={false}
        onAction={vi.fn()}
        onSelectTask={vi.fn()}
        onEditProviders={onEditProviders}
      />
    </TooltipProvider>
  )
  fireEvent.click(
    within(screen.getByRole('region', { name: 'Mission Home' })).getByRole('button', {
      name: 'Edit providers'
    })
  )
  expect(onEditProviders).toHaveBeenCalledTimes(1)
})
