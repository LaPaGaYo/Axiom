// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { axiomClient } from '@/lib/axiom-client'
import {
  TASK_STAGES,
  isLegalTaskStageTransition
} from '../../../../shared/axiom-contract/lifecycle'
import {
  TaskDetail,
  cancelItem,
  cancelText,
  dependentsText,
  quietCancelProps
} from './task-quiet-cancel.test-support'

vi.mock('@/lib/axiom-client', () => ({
  axiomClient: { readArtifact: vi.fn(), cancelTask: vi.fn() }
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})
const detail = () => screen.getByRole('region', { name: 'Task detail' })
const cancelButtons = () => within(detail()).queryAllByRole('button', { name: 'Cancel Task' })
function quietButton() {
  expect(cancelButtons()).toHaveLength(1)
  const button = cancelButtons()[0]!
  expect(button.getAttribute('data-variant')).toBe('ghost')
  expect(button.getAttribute('data-size')).toBe('sm')
  return button
}
function openForm() {
  fireEvent.click(quietButton())
  return screen.getByRole('form', { name: 'Cancel Task' })
}

it('offers a quiet cancel control on an unfinished Task that no pending item covers', () => {
  for (const stage of TASK_STAGES) {
    const p = quietCancelProps()
    const { rerender, unmount } = render(<TaskDetail {...p} task={{ ...p.task, stage }} />)
    expect(cancelButtons()).toHaveLength(isLegalTaskStageTransition(stage, 'CANCELED') ? 1 : 0)
    if (isLegalTaskStageTransition(stage, 'CANCELED')) {
      const button = quietButton()
      expect(button.getAttribute('aria-expanded')).toBe('false')
      expect(button.hasAttribute('aria-controls')).toBe(false)
      const waiting = screen.getByRole('region', { name: 'Waiting on' })
      expect(waiting.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    }
    expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
    rerender(<TaskDetail {...p} task={{ ...p.task, stage }} onCancelTask={undefined} />)
    expect(cancelButtons()).toHaveLength(0)
    unmount()
  }
})

it('leaves the cancellation to the Task actions region when a pending item lists it', () => {
  const p = quietCancelProps()
  const other = { ...cancelItem, taskId: 'other-task' }
  const { rerender } = render(<TaskDetail {...p} pendingItems={[other]} />)
  quietButton()
  rerender(
    <TaskDetail {...p} pendingItems={[{ ...cancelItem, actions: ['axiom.policy.update'] }]} />
  )
  openForm()
  rerender(<TaskDetail {...p} pendingItems={[other, cancelItem]} />)
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  expect(document.activeElement).toBe(detail())
  const region = screen.getByRole('region', { name: 'Task actions' })
  expect(
    within(region)
      .getAllByRole('button')
      .map((button) => button.textContent)
  ).toEqual(['Cancel Task'])
  expect(cancelButtons()).toHaveLength(1)
  const trigger = within(region).getByRole('button', { name: 'Cancel Task' })
  expect(trigger.getAttribute('data-variant')).toBe('outline')
  fireEvent.click(trigger)
  rerender(<TaskDetail {...p} pendingItems={[other]} />)
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  quietButton()
  expect(document.activeElement).toBe(detail())
})

it('offers no cancel control on a finished Task', () => {
  const p = quietCancelProps()
  const { rerender } = render(<TaskDetail {...p} />)
  quietButton()
  for (const stage of ['INTEGRATED', 'CANCELED'] as const) {
    for (const pendingItems of [[], [{ ...cancelItem, taskId: 'other-task' }]]) {
      rerender(<TaskDetail {...p} task={{ ...p.task, stage }} pendingItems={pendingItems} />)
      expect(cancelButtons()).toHaveLength(0)
    }
  }
  rerender(<TaskDetail {...p} />)
  openForm()
  rerender(<TaskDetail {...p} task={{ ...p.task, stage: 'CANCELED' }} />)
  expect(cancelButtons()).toHaveLength(0)
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  expect(document.activeElement).toBe(detail())
})

it('states what canceling does without a number when no pending item names the Task', () => {
  render(<TaskDetail {...quietCancelProps()} />)
  const form = openForm()
  expect(within(form).getByText(cancelText, { exact: true })).toBeTruthy()
  expect(within(form).getByText(dependentsText, { exact: true })).toBeTruthy()
  expect(within(form).queryByText(/Tasks that depend on it:/)).toBeNull()
  expect(form.textContent).not.toMatch(/\d/)
  expect(
    within(form).getByRole('button', { name: 'Cancel Task' }).getAttribute('data-variant')
  ).toBe('destructive')
  expect(within(form).getByRole('button', { name: 'Close' }).getAttribute('data-variant')).toBe(
    'ghost'
  )
})

it('hands a quiet cancellation to the page with its rationale and consequence', async () => {
  const p = quietCancelProps()
  const { rerender } = render(<TaskDetail {...p} />)
  openForm()
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(p.onCancelTask).not.toHaveBeenCalled()
  const form = openForm()
  const rationale = within(form).getByRole('textbox', { name: 'Rationale' })
  const submit = within(form).getByRole('button', { name: 'Cancel Task' })
  expect(rationale.hasAttribute('required')).toBe(true)
  expect(rationale.getAttribute('maxlength')).toBe('4000')
  expect(submit.hasAttribute('disabled')).toBe(true)
  fireEvent.submit(form)
  fireEvent.change(rationale, { target: { value: '   ' } })
  expect(submit.hasAttribute('disabled')).toBe(true)
  fireEvent.submit(form)
  expect(p.onCancelTask).not.toHaveBeenCalled()
  const typed = '  This Task is no longer needed.  '
  fireEvent.change(rationale, { target: { value: typed } })
  rerender(<TaskDetail {...p} busy />)
  expect(submit.hasAttribute('disabled')).toBe(true)
  fireEvent.submit(form)
  expect(p.onCancelTask).not.toHaveBeenCalled()
  rerender(<TaskDetail {...p} />)
  await act(async () => fireEvent.click(submit))
  expect(p.onCancelTask).toHaveBeenCalledExactlyOnceWith(
    { taskId: p.task.id, rationale: typed.trim() },
    `${cancelText} ${dependentsText}`
  )
  expect(axiomClient.cancelTask).not.toHaveBeenCalled()
  rerender(<TaskDetail {...p} pendingItems={[]} />)
  expect(screen.getByRole('form', { name: 'Cancel Task' })).toBe(form)
  expect(rationale).toHaveProperty('value', typed)
})

it('returns focus to the quiet cancel control when its form is closed', () => {
  const p = quietCancelProps()
  const { rerender } = render(<TaskDetail {...p} />)
  const trigger = quietButton()
  const form = openForm()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.getElementById(trigger.getAttribute('aria-controls')!)?.contains(form)).toBe(true)
  const rationale = screen.getByRole('textbox', { name: 'Rationale' })
  expect(document.activeElement).toBe(rationale)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(trigger.hasAttribute('aria-controls')).toBe(false)
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  rerender(<TaskDetail {...p} busy />)
  expect(trigger.hasAttribute('disabled')).toBe(true)
  fireEvent.click(trigger)
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  rerender(<TaskDetail {...p} />)
  openForm()
  fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), {
    target: { value: 'Belongs to the first Task' }
  })
  rerender(<TaskDetail {...p} task={{ ...p.task, id: 'another-task' }} />)
  expect(screen.queryByRole('form', { name: 'Cancel Task' })).toBeNull()
  expect(quietButton().getAttribute('aria-expanded')).toBe('false')
  openForm()
  expect(screen.getByRole('textbox', { name: 'Rationale' })).toHaveProperty('value', '')
  expect(p.onCancelTask).not.toHaveBeenCalled()
})

it('keeps the quiet cancel control when the pending read fails', () => {
  const p = quietCancelProps()
  const { rerender } = render(<TaskDetail {...p} pendingError />)
  quietButton()
  const note = 'Actions could not be read. Refresh to try again.'
  expect(screen.queryByText(note)).toBeNull()
  rerender(
    <TaskDetail
      {...p}
      task={{
        ...p.task,
        waitingOn: { on: 'dependency', reason: 'upstream_canceled', person: true }
      }}
      pendingError
    />
  )
  const button = quietButton()
  expect(screen.getByText(note)).toBeTruthy()
  expect(
    screen.getByText(note).compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING
  ).not.toBe(0)
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
  openForm()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Rationale' }))
})
