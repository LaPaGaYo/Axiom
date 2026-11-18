// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { taskWithSpec } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskIntegration } from '../../../../shared/axiom-contract/integration-batch'
import { MissionIntegration } from './MissionIntegration'

const head = '3'.repeat(40)
const integration = { branch: 'axiom/integration/mission-1', recordedHead: head }
const batch: TaskIntegration = {
  batchId: 'batch-1',
  candidateId: 'candidate-1',
  status: 'PROMOTED',
  baseCommit: '1'.repeat(40),
  mergeCommit: '2'.repeat(40),
  conflicts: [],
  updatedAt: '2026-11-18T12:05:00Z'
}
const promoted = { ...taskWithSpec, title: 'First integrated Task', integration: batch }
const conflicted = {
  ...taskWithSpec,
  id: 'task-2',
  title: 'Conflicted Task',
  integration: {
    ...batch,
    batchId: 'batch-2',
    status: 'CONFLICT' as const,
    mergeCommit: null,
    conflicts: ['src/one.ts', 'src/two.ts']
  }
}
afterEach(cleanup)

it('renders nothing without a recorded head or a batch', () => {
  const { container } = render(<MissionIntegration tasks={[taskWithSpec]} onSelect={vi.fn()} />)
  expect(container.childElementCount).toBe(0)
})

it('shows the integration branch and the recorded head', () => {
  render(<MissionIntegration integration={integration} tasks={[taskWithSpec]} onSelect={vi.fn()} />)
  expect(screen.getByRole('region', { name: 'Integration' })).toBeTruthy()
  expect(screen.getByText(integration.branch)).toBeTruthy()
  const recordedHead = screen.getByTestId('integration-recorded-head')
  expect(recordedHead.textContent).toBe('3333333')
  expect(recordedHead.getAttribute('title')).toBe(head)
  expect(screen.getByText('No Task has reached integration yet.')).toBeTruthy()
  expect(screen.queryByRole('table')).toBeNull()
})

it('lists each Task that has a batch with its status and merge commit', () => {
  render(<MissionIntegration tasks={[promoted, taskWithSpec, conflicted]} onSelect={vi.fn()} />)
  const table = screen.getByRole('table', { name: 'Integration batches' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(2)
  for (const [index, task] of [promoted, conflicted].entries()) {
    const row = rows[index]
    if (!row) {
      throw new Error('Missing integration row')
    }
    expect(row.getAttribute('data-integration-task-id')).toBe(task.id)
    expect(row.getAttribute('data-integration-status')).toBe(task.integration.status)
    expect(within(row).getByText(task.title)).toBeTruthy()
    expect(within(row).getByText(task.integration.status)).toBeTruthy()
    expect(row.querySelector('time')?.getAttribute('dateTime')).toBe(batch.updatedAt)
    expect(row.querySelector('time')?.textContent).toBe(batch.updatedAt)
  }
  const [first, second] = rows
  if (!first || !second) {
    throw new Error('Missing integration rows')
  }
  expect(within(first).getByText('Promoted')).toBeTruthy()
  expect(within(first).getByText('2222222').getAttribute('title')).toBe(batch.mergeCommit)
  expect(within(first).queryByText(/conflicting file/)).toBeNull()
  expect(within(second).getByText('Merge conflict')).toBeTruthy()
  expect(within(second).getByText('2 conflicting file(s)')).toBeTruthy()
  expect(within(second).getByText('—')).toBeTruthy()
})

it('selects the Task of a batch row by click and by keyboard', () => {
  const select = vi.fn()
  render(<MissionIntegration tasks={[promoted]} selectedTaskId={promoted.id} onSelect={select} />)
  const row = screen.getByRole('row', { selected: true })
  expect(row.getAttribute('aria-selected')).toBe('true')
  expect(row.tabIndex).toBe(0)
  fireEvent.click(row)
  fireEvent.keyDown(row, { key: 'Enter' })
  fireEvent.keyDown(row, { key: ' ' })
  expect(select.mock.calls).toEqual([[promoted.id], [promoted.id], [promoted.id]])
})
