// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { MissionCreateDialog } from './MissionCreateDialog'

afterEach(cleanup)

it('preserves the create payload on retry and uses the current form for a new action', () => {
  const onCreate = vi.fn(async () => {})
  render(<MissionCreateDialog busy={false} error={null} onClose={vi.fn()} onCreate={onCreate} />)
  fireEvent.change(screen.getByLabelText('Repository path'), { target: { value: '/repo' } })
  fireEvent.change(screen.getByLabelText('Goal objective'), {
    target: { value: 'Deliver sprints' }
  })
  fireEvent.change(screen.getByLabelText('Acceptance criteria'), {
    target: { value: 'Checks pass\nOffline' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create Mission' }))
  fireEvent.click(screen.getByRole('button', { name: 'Create Mission' }))
  expect(onCreate).toHaveBeenCalledTimes(2)
  expect(onCreate.mock.calls[0]).toEqual(onCreate.mock.calls[1])
  expect(onCreate).toHaveBeenCalledWith(
    expect.objectContaining({
      goal: expect.objectContaining({ acceptanceCriteria: ['Checks pass', 'Offline'] })
    })
  )
  fireEvent.change(screen.getByLabelText('Goal objective'), {
    target: { value: 'A different Goal' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Create Mission' }))
  expect(onCreate).toHaveBeenLastCalledWith(
    expect.objectContaining({ goal: expect.objectContaining({ objective: 'A different Goal' }) })
  )
})
