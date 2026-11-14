// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { taskWithSpec } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskListItem } from '../../../../shared/axiom-contract/task-params'
import { TaskStageTable } from './TaskStageTable'

afterEach(cleanup)
it('shows what each Task waits on in the Task table', () => {
  const tasks: TaskListItem[] = [
    { ...taskWithSpec, waitingOn: { on: 'human', reason: 'acceptance_human', person: true } },
    {
      ...taskWithSpec,
      id: 'dependent',
      title: 'Dependent Task',
      stage: 'DEFINED',
      orcaStatus: 'ready',
      waitingOn: { on: 'dependency', reason: 'upstream_not_integrated', person: false }
    },
    { ...taskWithSpec, id: 'legacy', title: 'Legacy Task' }
  ]
  const onSelect = vi.fn()
  render(<TaskStageTable tasks={tasks} selectedTaskId={tasks[0].id} onSelect={onSelect} />)
  const table = screen.getByRole('table', { name: 'Tasks' })
  expect(within(table).queryByRole('columnheader', { name: 'Waiting on' })).not.toBeNull()
  expect(
    within(table)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent)
  ).toEqual(['Task', 'Stage', 'Waiting on'])
  const rows = within(table).getAllByRole('row').slice(1)
  rows.forEach((row, i) => {
    expect(row.getAttribute('data-task-id')).toBe(tasks[i].id)
    expect(row.getAttribute('aria-selected')).toBe(String(i === 0))
    expect(row.querySelector('[data-task-stage]')?.getAttribute('data-task-stage')).toBe(
      tasks[i].stage
    )
    const cells = within(row).getAllByRole('cell')
    expect(cells[0].textContent).toContain(tasks[i].title)
    expect(cells[1].textContent).toContain('Execution projection:')
    expect(within(cells[2]).queryAllByRole('button')).toHaveLength(0)
    expect(within(cells[2]).queryAllByRole('link')).toHaveLength(0)
    fireEvent.click(cells[2])
    expect(onSelect).toHaveBeenLastCalledWith(tasks[i].id)
  })
  expect(within(rows[0]).getByText('human · acceptance_human').className).toContain('font-mono')
  expect(rows[0].textContent).toContain('Waiting for a person to review or resolve this Task.')
  expect(within(rows[0]).getByText('Needs a person').className).toContain('text-status-warning')
  expect(within(rows[1]).getByText('dependency · upstream_not_integrated').className).toContain(
    'font-mono'
  )
  expect(rows[1].textContent).toContain('Waiting for upstream Tasks to be integrated.')
  expect(within(rows[1]).queryByText('Needs a person')).toBeNull()
  expect(within(rows[2]).getAllByRole('cell')[2].textContent).toBe('')
  fireEvent.keyDown(rows[1], { key: 'Enter' })
  fireEvent.keyDown(rows[2], { key: ' ' })
  expect(onSelect.mock.calls.map(([id]) => id)).toEqual([
    tasks[0].id,
    'dependent',
    'legacy',
    'dependent',
    'legacy'
  ])
  expect(table.textContent).not.toMatch(/done|completed/i)
})
