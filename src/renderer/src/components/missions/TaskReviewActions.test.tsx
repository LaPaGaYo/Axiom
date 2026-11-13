// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attempt,
  verificationRun,
  reviewPendingItem
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
afterEach(cleanup)
const task = {
  id: attempt.taskId,
  missionId: attempt.missionId,
  planRevisionId: 'plan-1',
  title: 'Review the example',
  stage: 'VERIFYING' as const,
  orcaStatus: 'completed' as const
}
const props = () => ({
  task,
  attempts: [attempt],
  messages: [],
  runs: [verificationRun],
  pendingItems: [reviewPendingItem],
  busy: false,
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onOpenWorktree: vi.fn(),
  onResolveVerification: vi.fn(async () => {}),
  onRerunVerification: vi.fn(async () => {})
})
const actions = () => screen.getByRole('region', { name: 'Task actions' })
const open = (name = 'Resolve review') => {
  fireEvent.click(within(actions()).getByRole('button', { name }))
  return screen.getByRole('form', { name })
}
const choose = (name: string) => fireEvent.click(screen.getByRole('radio', { name }))
const rationale = (value = '  Reviewed the evidence.  ') =>
  fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), { target: { value } })
const submit = () => screen.getByRole('button', { name: 'Submit resolution' })

it('offers no action on a Task that has no pending item', () => {
  const p = props()
  render(<TaskDetail {...p} pendingItems={[]} />)
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
  expect(screen.queryByRole('heading', { name: 'Task actions' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
  expect(p.onResolveVerification).not.toHaveBeenCalled()
  expect(p.onRerunVerification).not.toHaveBeenCalled()
})

it('offers the actions the pending item of the Task lists and no others', () => {
  const p = props()
  const other = { ...reviewPendingItem, id: 'other', taskId: 'other-task' }
  const blocked = {
    ...reviewPendingItem,
    id: 'blocked',
    kind: 'task_blocked' as const,
    objectId: task.id,
    actions: [
      'axiom.task.adjust',
      'axiom.verification.rerun',
      'axiom.policy.update',
      'axiom.task.cancel'
    ] as const
  }
  const { rerender } = render(
    <TaskDetail
      {...p}
      pendingItems={[reviewPendingItem, { ...blocked, actions: [...blocked.actions] }, other]}
    />
  )
  expect(
    within(actions())
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Resolve review', 'Rerun verification', 'Adjust Task', 'Cancel Task'])
  expect(screen.queryByRole('textbox')).toBeNull()
  rerender(
    <TaskDetail
      {...p}
      task={{ ...task, stage: 'BLOCKED' }}
      pendingItems={[{ ...blocked, actions: [...blocked.actions] }, other]}
    />
  )
  expect(
    within(actions())
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Adjust Task', 'Rerun verification', 'Cancel Task'])
  rerender(
    <TaskDetail
      {...p}
      pendingItems={[
        {
          ...reviewPendingItem,
          actions: ['axiom.verification.rerun', 'axiom.verification.resolve']
        }
      ]}
    />
  )
  expect(
    within(actions())
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Rerun verification', 'Resolve review'])
  rerender(<TaskDetail {...p} pendingItems={[other]} />)
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
})

it('opens one action form at a time and closes it without a call', () => {
  const p = props()
  render(<TaskDetail {...p} />)
  const trigger = within(actions()).getByRole('button', { name: 'Resolve review' })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  open()
  expect(trigger.getAttribute('aria-expanded')).toBe('true')
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'PASS' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(trigger)
  expect(screen.queryByRole('textbox')).toBeNull()
  open()
  open('Rerun verification')
  expect(screen.getAllByRole('form')).toHaveLength(1)
  expect(screen.queryByRole('form', { name: 'Resolve review' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Rationale' }))
  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(document.activeElement).toBe(
    within(actions()).getByRole('button', { name: 'Rerun verification' })
  )
  expect(p.onResolveVerification).not.toHaveBeenCalled()
  expect(p.onRerunVerification).not.toHaveBeenCalled()
})

it('asks for no disposition when the plan asked for the review', async () => {
  for (const reason of ['acceptance_human', 'non_code']) {
    const p = props()
    const mounted = render(
      <TaskDetail
        {...p}
        runs={[{ ...verificationRun, verdictDetail: { ...verificationRun.verdictDetail, reason } }]}
      />
    )
    const form = open()
    expect(within(form).getByText(reason).className).toContain('font-mono')
    expect(within(form).getByText(verificationRun.id).className).toContain('font-mono')
    expect(screen.getByRole('radiogroup', { name: 'Verdict' })).toBeTruthy()
    expect(
      screen.getAllByRole('radio').every((r) => r.getAttribute('aria-checked') === 'false')
    ).toBe(true)
    choose('PASS')
    expect(within(form).queryByText('Disposition', { exact: true })).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Disposition' })).toBeNull()
    expect(form.textContent).toContain('VERIFIED')
    expect(form.textContent).toContain('cannot be resolved again')
    rationale()
    await act(async () => fireEvent.click(submit()))
    expect(p.onResolveVerification).toHaveBeenCalledWith({
      runId: verificationRun.id,
      verdict: 'PASS',
      criteria: [],
      rationale: 'Reviewed the evidence.'
    })
    mounted.unmount()
  }
})

it('requires one of three dispositions to pass a run the checks flagged', () => {
  for (const reason of ['test_tampering', undefined, 'future_reason']) {
    const p = props()
    const mounted = render(
      <TaskDetail {...p} runs={[{ ...verificationRun, verdictDetail: { reason } }]} />
    )
    open()
    choose('PASS')
    rationale()
    const group = screen.getByRole('radiogroup', { name: 'Disposition' })
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.getAttribute('aria-label'))
    ).toEqual(['rejected', 'intentional', 'not_worth'])
    expect(
      within(group)
        .getAllByRole('radio')
        .every((r) => r.getAttribute('aria-checked') === 'false')
    ).toBe(true)
    expect(submit().hasAttribute('disabled')).toBe(true)
    choose('intentional')
    expect(submit().hasAttribute('disabled')).toBe(false)
    choose('FAIL')
    expect(screen.queryByRole('radiogroup', { name: 'Disposition' })).toBeNull()
    expect(within(screen.getByRole('form')).getByText('fixed').className).toContain('font-mono')
    expect(within(screen.getByRole('form')).getByText('sent back to be fixed')).toBeTruthy()
    choose('PASS')
    expect(submit().hasAttribute('disabled')).toBe(true)
    mounted.unmount()
  }
})

it('sends fixed when a person fails a run', async () => {
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  const form = open()
  choose('FAIL')
  expect(form.textContent).toContain('next Attempt is told the rationale')
  expect(form.textContent).toContain('cannot be resolved again')
  rationale()
  await act(async () => fireEvent.click(submit()))
  expect(p.onResolveVerification).toHaveBeenCalledWith({
    runId: verificationRun.id,
    verdict: 'FAIL',
    criteria: [],
    disposition: 'fixed',
    rationale: 'Reviewed the evidence.'
  })
  rerender(<TaskDetail {...p} pendingItems={[]} />)
  expect(screen.queryByRole('form')).toBeNull()
  expect(screen.queryByRole('region', { name: 'Task actions' })).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Task detail' }))
})

it('names the criteria a person ticks in the resolution', async () => {
  const p = props()
  render(<TaskDetail {...p} />)
  const form = open()
  choose('FAIL')
  const criteria = screen.getByRole('group', { name: 'Criteria named in the resolution' })
  expect(form.textContent).toContain('The next Attempt is told the ticked criteria failed.')
  fireEvent.click(within(criteria).getByRole('checkbox', { name: '#1 · The example is clear' }))
  fireEvent.click(within(criteria).getByRole('checkbox', { name: '#0 · The command passes' }))
  choose('PASS')
  expect(form.textContent).toContain('The ticked criteria are recorded with the resolution.')
  rationale()
  await act(async () => fireEvent.click(submit()))
  expect(p.onResolveVerification).toHaveBeenCalledWith({
    runId: verificationRun.id,
    verdict: 'PASS',
    criteria: [0, 1],
    rationale: 'Reviewed the evidence.'
  })
})

it('requires a rationale and respects the busy state in both forms', async () => {
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  open()
  const text = screen.getByRole('textbox', { name: 'Rationale' })
  expect(text.getAttribute('maxlength')).toBe('4000')
  expect(text.hasAttribute('required')).toBe(true)
  rationale()
  expect(submit().hasAttribute('disabled')).toBe(true)
  choose('PASS')
  rationale('   ')
  expect(submit().hasAttribute('disabled')).toBe(true)
  rationale()
  rerender(<TaskDetail {...p} busy />)
  expect(submit().hasAttribute('disabled')).toBe(true)
  rerender(<TaskDetail {...p} />)
  await act(async () => fireEvent.click(submit()))
  // A refusal is reported by the controller; unchanged pending props retain this draft.
  rerender(<TaskDetail {...p} pendingItems={[{ ...reviewPendingItem }]} />)
  expect(screen.getByRole('form', { name: 'Resolve review' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Rationale' }).getAttribute('maxlength')).toBe('4000')
  expect(screen.getByRole('textbox', { name: 'Rationale' })).toHaveProperty(
    'value',
    '  Reviewed the evidence.  '
  )
  expect(screen.getByRole('radio', { name: 'PASS' }).getAttribute('aria-checked')).toBe('true')
  open('Rerun verification')
  const queue = screen.getByRole('button', { name: 'Queue rerun' })
  expect(screen.getByRole('textbox', { name: 'Rationale' }).hasAttribute('required')).toBe(true)
  expect(screen.getByRole('textbox', { name: 'Rationale' }).getAttribute('maxlength')).toBe('4000')
  expect(queue.hasAttribute('disabled')).toBe(true)
  rationale('   ')
  expect(queue.hasAttribute('disabled')).toBe(true)
  rationale('Retry evidence')
  rerender(<TaskDetail {...p} busy />)
  expect(queue.hasAttribute('disabled')).toBe(true)
  rerender(<TaskDetail {...p} />)
  expect(queue.hasAttribute('disabled')).toBe(false)
  await act(async () => fireEvent.click(queue))
  expect(screen.getByRole('form', { name: 'Rerun verification' })).toBeTruthy()
  expect(screen.getByDisplayValue('Retry evidence')).toBeTruthy()
})

it('queues a rerun with the rationale a person gave', async () => {
  const p = props()
  render(<TaskDetail {...p} />)
  const form = open('Rerun verification')
  expect(form.textContent).toContain('same Candidate')
  expect(form.textContent).toContain('waiting for review is canceled')
  rationale('  Recheck the environment.  ')
  await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Queue rerun' })))
  expect(p.onRerunVerification).toHaveBeenCalledWith({
    taskId: task.id,
    rationale: 'Recheck the environment.'
  })
  expect(p.onResolveVerification).not.toHaveBeenCalled()
})

it('explains an unreadable review run without offering a resolution form', () => {
  render(<TaskDetail {...props()} runs={[]} />)
  fireEvent.click(within(actions()).getByRole('button', { name: 'Resolve review' }))
  expect(screen.getByText('The run could not be read. Refresh to try again.')).toBeTruthy()
  expect(screen.queryByRole('form', { name: 'Resolve review' })).toBeNull()
  expect(screen.queryByRole('textbox')).toBeNull()
})
