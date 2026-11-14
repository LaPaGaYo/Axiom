// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { axiomClient } from '@/lib/axiom-client'
import {
  attempt,
  message,
  reviewPendingItem,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({
  axiomClient: { readArtifact: vi.fn(), adjustTask: vi.fn(), cancelTask: vi.fn() }
}))
afterEach(cleanup)
const blocked: MissionPendingItem = {
  ...reviewPendingItem,
  kind: 'task_blocked',
  objectId: taskWithSpec.id,
  reason: 'scope',
  blocks: 3,
  actions: [
    'axiom.task.adjust',
    'axiom.verification.rerun',
    'axiom.policy.update',
    'axiom.task.cancel'
  ]
}
const scopeMessage = {
  ...message,
  type: 'BLOCKED' as const,
  blocked: { reason: 'blocked_by_scope' as const, paths: ['src/services/date-range.test.ts'] }
}
const props = () => ({
  task: taskWithSpec,
  taskSpec: taskWithSpec.spec,
  attempts: [attempt],
  messages: [],
  runs: [verificationRun],
  pendingItems: [blocked],
  busy: false,
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onOpenWorktree: vi.fn(),
  onAdjustTask: vi.fn(async () => {}),
  onCancelTask: vi.fn(async () => {})
})
const actions = () => screen.getByRole('region', { name: 'Task actions' })
function open(name = 'Adjust Task') {
  fireEvent.click(within(actions()).getByRole('button', { name }))
  return screen.getByRole('form', { name })
}
const fill = (name: string, value: string) =>
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
const apply = () => screen.getByRole('button', { name: 'Apply adjustment' })
const cancelText =
  'Canceling stops the running Attempt of this Task. Its work is not integrated, and a canceled Task cannot be resumed.'
const scopeText =
  'The Worker asked for paths outside the scope of the Task. Add them and the next Attempt can continue.'

it('offers adjust and cancel in the order the pending item lists them', () => {
  const p = props()
  const other = { ...blocked, taskId: 'other-task' }
  const stall: MissionPendingItem = {
    ...blocked,
    kind: 'stall_notice',
    objectId: attempt.attemptId,
    reason: 'stalled',
    blocking: false,
    blocks: 0,
    actions: ['axiom.task.cancel']
  }
  const { rerender } = render(
    <TaskDetail {...p} pendingItems={[reviewPendingItem, blocked, other]} />
  )
  const names = () =>
    within(actions())
      .getAllByRole('button')
      .map((b) => b.textContent)
  expect(names()).toEqual(['Resolve review', 'Rerun verification', 'Adjust Task', 'Cancel Task'])
  expect(screen.queryByRole('textbox')).toBeNull()
  rerender(<TaskDetail {...p} pendingItems={[blocked, reviewPendingItem, other]} />)
  expect(names()).toEqual(['Adjust Task', 'Rerun verification', 'Cancel Task', 'Resolve review'])
  const form = open('Cancel Task')
  // The first item offering cancel supplies its consequence, not the review item after it.
  expect(form.textContent).toContain('Tasks that depend on it: 2.')
  expect(document.activeElement).toBe(within(form).getByRole('textbox', { name: 'Rationale' }))
  open()
  expect(screen.getAllByRole('form')).toHaveLength(1)
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Allowed paths to add' }))
  const trigger = within(actions()).getByRole('button', { name: 'Adjust Task' })
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(
    document
      .getElementById(trigger.getAttribute('aria-controls')!)
      ?.contains(screen.getByRole('form', { name: 'Adjust Task' }))
  ).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(trigger)
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  expect(p.onAdjustTask).not.toHaveBeenCalled()
  expect(p.onCancelTask).not.toHaveBeenCalled()
  rerender(<TaskDetail {...p} pendingItems={[blocked, other]} />)
  expect(names()).toEqual(['Adjust Task', 'Rerun verification', 'Cancel Task'])
  rerender(<TaskDetail {...p} pendingItems={[stall, other]} />)
  expect(names()).toEqual(['Cancel Task'])
  open('Cancel Task')
  rerender(<TaskDetail {...p} pendingItems={[other]} />)
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Task detail' }))
})

it('shows the scope and limits of the Task in the adjust form', () => {
  for (const dimension of ['maxAttempts', 'maxTokens'] as const) {
    const p = props()
    const spec = { ...p.taskSpec, budget: { maxTokens: 1200 } }
    const item: MissionPendingItem = {
      ...blocked,
      waitingOn: {
        on: 'budget',
        reason: 'task_tokens',
        person: true,
        budget: { scope: 'task', dimension, limit: dimension === 'maxTokens' ? 1200 : 2, used: 2 }
      }
    }
    const { unmount } = render(<TaskDetail {...p} taskSpec={spec} pendingItems={[item]} />)
    const form = open()
    for (const path of spec.scope.allowedPaths) {
      expect(within(form).getByText(path).className).toContain('font-mono')
    }
    expect(within(form).getByText('Allowed paths')).toBeTruthy()
    const limits = within(form).getByText(
      dimension === 'maxTokens' ? 'Token limit' : 'Attempt limit'
    ).parentElement!
    expect(limits.textContent).toContain(dimension === 'maxTokens' ? '1200' : '2')
    expect(within(limits).getByText('2 used')).toBeTruthy()
    expect(within(form).getByRole('textbox', { name: 'New Attempt limit' })).toHaveProperty(
      'value',
      ''
    )
    expect(within(form).getByRole('textbox', { name: 'New token limit' })).toHaveProperty(
      'value',
      ''
    )
    unmount()
  }
  const p = props()
  render(<TaskDetail {...p} taskSpec={{ ...p.taskSpec, scope: { allowedPaths: [] } }} />)
  const form = open()
  expect(within(form).getByText('None')).toBeTruthy()
  expect(within(form).getByText('No limit')).toBeTruthy()
})

it('prefills the paths the Worker asked for when the Task is blocked by scope', () => {
  for (const [pending, reason, expected] of [
    [true, 'scope', scopeMessage.blocked.paths[0]],
    [false, 'scope', ''],
    [true, 'candidate_disputed', '']
  ] as const) {
    const { unmount } = render(
      <TaskDetail
        {...props()}
        pendingItems={[{ ...blocked, reason }]}
        messages={[{ ...scopeMessage, pending }]}
      />
    )
    open()
    expect(screen.getByRole('textbox', { name: 'Allowed paths to add' })).toHaveProperty(
      'value',
      expected
    )
    expect(screen.getByText('One path per line.')).toBeTruthy()
    unmount()
  }
})

it('says what resolves the block for the reason the pending item gives', () => {
  const cases = [
    ['scope', scopeText],
    [
      'candidate_disputed',
      'The Worker reported that the Candidate is already correct or that the failure cannot be reproduced. A rationale alone reopens the Task for another Attempt.'
    ],
    [
      'environment',
      'The environment interrupted the Attempts of this Task repeatedly. A rationale alone reopens the Task.'
    ],
    [
      'retry_budget_exhausted',
      'The Attempts of this Task are used up. Raise the Attempt limit above the number used.'
    ],
    [
      'task_attempts',
      'The Attempts of this Task are used up. Raise the Attempt limit above the number used.'
    ],
    [
      'token_budget_exhausted',
      'The token limit of this Task is reached. Raise it above the tokens used, and raise the Attempt limit too when the Attempts are used up.'
    ],
    [
      'task_tokens',
      'The token limit of this Task is reached. Raise it above the tokens used, and raise the Attempt limit too when the Attempts are used up.'
    ]
  ]
  const reviewText =
    'The review stays open after an adjustment. Rerun verification to check the same Candidate against the adjusted Task.'
  for (const [reason, text] of cases) {
    const { unmount } = render(<TaskDetail {...props()} pendingItems={[{ ...blocked, reason }]} />)
    expect(within(open()).getByText(text)).toBeTruthy()
    unmount()
  }
  const { rerender } = render(
    <TaskDetail {...props()} pendingItems={[{ ...reviewPendingItem, reason: 'scope' }]} />
  )
  expect(within(open()).getByText(reviewText)).toBeTruthy()
  rerender(
    <TaskDetail
      {...props()}
      pendingItems={[{ ...reviewPendingItem, kind: 'task_blocked', reason: 'future_reason' }]}
    />
  )
  for (const text of [...cases.map((c) => c[1]), reviewText]) {
    expect(screen.queryByText(text)).toBeNull()
  }
})

it('sends only what a person gave in an adjustment', async () => {
  for (const [paths, attempts, tokens, expected] of [
    ['', '', '', { addAllowedPaths: [] }],
    [
      ' src/a.ts \n\n src/b.ts\n src/a.ts\n ',
      '',
      '',
      { addAllowedPaths: ['src/a.ts', 'src/b.ts'] }
    ],
    ['', '1', '', { addAllowedPaths: [], maxAttempts: 1 }],
    ['', '', '1', { addAllowedPaths: [], maxTokens: 1 }],
    ['', '3', '2000', { addAllowedPaths: [], maxAttempts: 3, maxTokens: 2000 }]
  ] as const) {
    const p = props()
    const { unmount } = render(<TaskDetail {...p} />)
    open()
    fill('Allowed paths to add', paths)
    fill('New Attempt limit', attempts)
    fill('New token limit', tokens)
    fill('Rationale', '  Reviewed the block.  ')
    await act(async () => fireEvent.click(apply()))
    expect(p.onAdjustTask).toHaveBeenCalledExactlyOnceWith({
      taskId: p.task.id,
      rationale: 'Reviewed the block.',
      ...expected
    })
    expect(axiomClient.adjustTask).not.toHaveBeenCalled()
    unmount()
  }
})

it('requires a rationale and whole numbers above zero in the adjust form', async () => {
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  open()
  const rationale = screen.getByRole('textbox', { name: 'Rationale' })
  expect(rationale.hasAttribute('required')).toBe(true)
  expect(rationale.getAttribute('maxlength')).toBe('4000')
  expect(apply().hasAttribute('disabled')).toBe(true)
  fill('Rationale', '   ')
  expect(apply().hasAttribute('disabled')).toBe(true)
  fill('Rationale', 'Keep this rationale')
  for (const name of ['New Attempt limit', 'New token limit']) {
    expect(screen.getByRole('textbox', { name }).getAttribute('inputmode')).toBe('numeric')
    for (const value of ['0', '-1', '1.5', '1e3', 'abc', ' ']) {
      fill(name, value)
      expect(screen.getByRole('textbox', { name })).toHaveProperty('value', value)
      expect(apply().hasAttribute('disabled')).toBe(true)
    }
    fill(name, '')
    expect(apply().hasAttribute('disabled')).toBe(false)
  }
  fill('Allowed paths to add', 'src/keep.ts')
  fill('New token limit', '1')
  rerender(<TaskDetail {...p} busy />)
  expect(apply().hasAttribute('disabled')).toBe(true)
  rerender(<TaskDetail {...p} />)
  await act(async () => fireEvent.click(apply()))
  rerender(<TaskDetail {...p} pendingItems={[{ ...blocked }]} />)
  expect(screen.getByRole('form', { name: 'Adjust Task' })).toBeTruthy()
  expect(rationale).toHaveProperty('value', 'Keep this rationale')
  expect(screen.getByRole('textbox', { name: 'Allowed paths to add' })).toHaveProperty(
    'value',
    'src/keep.ts'
  )
  expect(screen.getByRole('textbox', { name: 'New token limit' })).toHaveProperty('value', '1')
  expect(p.onAdjustTask).toHaveBeenCalledTimes(1)
  rerender(<TaskDetail {...p} pendingItems={[]} />)
  expect(screen.queryByRole('form')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Task detail' }))
})

it('replaces the adjust form by a note when the Task could not be read', () => {
  render(<TaskDetail {...props()} taskSpec={undefined} />)
  const trigger = within(actions()).getByRole('button', { name: 'Adjust Task' })
  fireEvent.click(trigger)
  expect(screen.getByText('The Task could not be read. Refresh to try again.')).toBeTruthy()
  expect(screen.queryByRole('form', { name: 'Adjust Task' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(trigger)
})

it('states what canceling a Task does and how many Tasks depend on it', () => {
  for (const [blocking, blocks, extra] of [
    [true, 3, 'Tasks that depend on it: 2. They wait until a person cancels them too.'],
    [true, 1, ''],
    [false, 0, 'Tasks that depend on it wait until a person cancels them too.']
  ] as const) {
    const { unmount } = render(
      <TaskDetail
        {...props()}
        pendingItems={[
          {
            ...blocked,
            blocking,
            blocks,
            kind: blocking ? 'task_blocked' : 'stall_notice'
          }
        ]}
      />
    )
    const form = open('Cancel Task')
    expect(within(form).getByText(cancelText)).toBeTruthy()
    if (extra) {
      expect(within(form).getByText(extra)).toBeTruthy()
    } else {
      expect(within(form).queryByText(/Tasks that depend on it/)).toBeNull()
    }
    unmount()
  }
})

it('hands a cancellation to the page with its rationale and consequence', async () => {
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  const form = open('Cancel Task')
  const submit = within(form).getByRole('button', { name: 'Cancel Task' })
  const text = within(form).getByRole('textbox', { name: 'Rationale' })
  expect(text.hasAttribute('required')).toBe(true)
  expect(text.getAttribute('maxlength')).toBe('4000')
  expect(submit.hasAttribute('disabled')).toBe(true)
  expect(submit.getAttribute('data-variant')).toBe('destructive')
  expect(
    within(actions())
      .getAllByRole('button', { name: 'Cancel Task' })[0]
      .getAttribute('data-variant')
  ).toBe('outline')
  expect(screen.getByRole('button', { name: 'Close' }).getAttribute('data-variant')).toBe('ghost')
  fill('Rationale', '   ')
  expect(submit.hasAttribute('disabled')).toBe(true)
  fill('Rationale', '  No longer needed.  ')
  rerender(<TaskDetail {...p} busy />)
  expect(submit.hasAttribute('disabled')).toBe(true)
  rerender(<TaskDetail {...p} />)
  await act(async () => fireEvent.click(submit))
  expect(p.onCancelTask).toHaveBeenCalledExactlyOnceWith(
    { taskId: p.task.id, rationale: 'No longer needed.' },
    `${cancelText} Tasks that depend on it: 2. They wait until a person cancels them too.`
  )
  expect(axiomClient.cancelTask).not.toHaveBeenCalled()
  expect(screen.getByRole('form', { name: 'Cancel Task' })).toBe(form)
  expect(text).toHaveProperty('value', '  No longer needed.  ')
})
