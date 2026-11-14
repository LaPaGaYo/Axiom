// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  reviewPendingItem,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
afterEach(cleanup)
it('closes the adjust form after an adjustment that went through', async () => {
  for (const accepted of [true, false]) {
    let settle: ((value: boolean) => void) | undefined
    const onAdjustTask = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          settle = resolve
        })
    )
    const props = {
      task: taskWithSpec,
      taskSpec: taskWithSpec.spec,
      attempts: [],
      messages: [],
      runs: [verificationRun],
      pendingItems: [reviewPendingItem],
      busy: false,
      onAnswer: vi.fn(),
      onResolve: vi.fn(),
      onOpenWorktree: vi.fn(),
      onAdjustTask
    }
    const { rerender, unmount } = render(<TaskDetail {...props} />)
    const actions = screen.getByRole('region', { name: 'Task actions' })
    const trigger = within(actions).getByRole('button', { name: 'Adjust Task' })
    fireEvent.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: 'New Attempt limit' }), {
      target: { value: '4' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), {
      target: { value: 'Allow another Attempt' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }))
    rerender(<TaskDetail {...props} busy />)
    expect(trigger.hasAttribute('disabled')).toBe(true)
    await act(async () => settle?.(accepted))
    if (accepted) {
      expect(screen.queryByRole('form', { name: 'Adjust Task' })).toBeNull()
      expect(within(actions).getAllByRole('button')).toHaveLength(4)
    } else {
      expect(screen.getByRole('form', { name: 'Adjust Task' })).toBeTruthy()
    }
    rerender(<TaskDetail {...props} />)
    if (accepted) {
      expect(trigger.hasAttribute('disabled')).toBe(false)
      expect(document.activeElement).toBe(trigger)
    } else {
      expect(screen.getByRole('textbox', { name: 'New Attempt limit' })).toHaveProperty(
        'value',
        '4'
      )
      expect(screen.getByRole('textbox', { name: 'Rationale' })).toHaveProperty(
        'value',
        'Allow another Attempt'
      )
    }
    expect(onAdjustTask).toHaveBeenCalledExactlyOnceWith({
      taskId: taskWithSpec.id,
      rationale: 'Allow another Attempt',
      addAllowedPaths: [],
      maxAttempts: 4
    })
    if (accepted) {
      fireEvent.click(trigger)
      fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), {
        target: { value: 'Reopen the blocked Task' }
      })
      fireEvent.click(screen.getByRole('button', { name: 'Apply adjustment' }))
      rerender(<TaskDetail {...props} pendingItems={[]} busy />)
      rerender(<TaskDetail {...props} pendingItems={[]} />)
      await act(async () => settle?.(true))
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Task detail' }))
      rerender(<TaskDetail {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Adjust Task' }))
      expect(document.activeElement).toBe(
        screen.getByRole('textbox', { name: 'Allowed paths to add' })
      )
    }
    unmount()
  }
})
