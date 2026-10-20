// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { attempt, message } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { TaskDetail } from './TaskDetail'
import { TaskStageTable } from './TaskStageTable'

afterEach(cleanup)
const task = {
  id: attempt.taskId,
  missionId: attempt.missionId,
  planRevisionId: 'plan',
  title: 'Task one',
  stage: 'SUBMITTED' as const,
  orcaStatus: 'completed' as const
}
const actions = () => ({ onAnswer: vi.fn(), onResolve: vi.fn(), onOpenWorktree: vi.fn() })

it('selects Task rows accessibly while preserving settled execution wording', () => {
  const onSelect = vi.fn()
  const { rerender } = render(
    <TaskStageTable tasks={[task]} selectedTaskId={null} onSelect={onSelect} />
  )
  const row = screen.getAllByRole('row')[1]
  fireEvent.click(row)
  expect(onSelect).toHaveBeenCalledWith(task.id)
  fireEvent.keyDown(row, { key: 'Enter' })
  expect(onSelect).toHaveBeenCalledTimes(2)
  rerender(<TaskStageTable tasks={[task]} selectedTaskId={task.id} onSelect={onSelect} />)
  expect(row.getAttribute('aria-selected')).toBe('true')
  expect(row.textContent).toContain('Attempt settled')
})

it('shows all Attempt projections, latest submission evidence and chronological messages', () => {
  const handlers = actions()
  const previous = {
    ...attempt,
    attemptId: 'old',
    seq: 1,
    submission: {
      ...attempt.submission,
      commitSha: 'c'.repeat(40),
      createdAt: '2026-10-20T11:00:00Z'
    }
  }
  render(
    <TaskDetail
      task={task}
      attempts={[
        { ...attempt, seq: 2, liveness: 'unverifiable', livenessReason: 'host_unreachable' },
        previous
      ]}
      messages={[
        {
          ...message,
          id: 'later',
          type: 'SUBMISSION',
          pending: false,
          summary: 'Candidate submitted',
          createdAt: '2026-10-20T12:05:00Z'
        },
        { ...message, pending: false, answer: 'Use A' }
      ]}
      busy={false}
      {...handlers}
    />
  )
  const detail = screen.getByRole('region', { name: 'Task detail' })
  const rows = within(detail).getByRole('table', { name: 'Attempts' }).querySelectorAll('tbody tr')
  expect(rows).toHaveLength(2)
  expect(detail.textContent).toContain('host_unreachable')
  expect(detail.textContent).toContain('retained')
  expect(detail.textContent).toContain(attempt.branch)
  const submission = within(detail).getByRole('region', { name: 'Submission summary' })
  expect(submission.querySelector('[title]')?.getAttribute('title')).toBe(
    attempt.submission.commitSha
  )
  expect(submission.textContent).toContain(attempt.submission.commitSha.slice(0, 7))
  for (const text of [
    'src/task.ts',
    'pnpm test',
    'pass',
    'Unit checks',
    'No host run',
    'Pending verification',
    'Verify candidate'
  ]) {
    expect(submission.textContent).toContain(text)
  }
  const timeline = within(detail).getByRole('list', { name: 'Task messages' })
  expect(
    within(timeline)
      .getAllByRole('listitem')
      .map((li) => li.textContent)
  ).toEqual([expect.stringContaining(message.summary), expect.stringContaining('SUBMISSION')])
  expect(timeline.textContent).toContain('Use A')
  fireEvent.click(within(detail).getAllByRole('button', { name: attempt.worktreeId })[0])
  expect(handlers.onOpenWorktree).toHaveBeenCalledWith(attempt.worktreeId)
})

it('requires text for pending answers and subtask decisions and respects the busy state', () => {
  const handlers = actions()
  const props = {
    task,
    attempts: [attempt],
    messages: [
      message,
      { ...message, id: 'subtask', type: 'REQUEST_SUBTASK' as const, summary: 'Add coverage' }
    ],
    ...handlers
  }
  const { rerender } = render(<TaskDetail {...props} busy={false} />)
  const answer = screen.getByRole('button', { name: 'Send answer' })
  const accept = screen.getByRole('button', { name: 'Accept' })
  expect(answer.hasAttribute('disabled')).toBe(true)
  expect(accept.hasAttribute('disabled')).toBe(true)
  fireEvent.change(screen.getByRole('textbox', { name: 'Answer' }), { target: { value: 'Use A' } })
  fireEvent.click(answer)
  expect(handlers.onAnswer).toHaveBeenCalledWith(message.id, 'Use A')
  fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), {
    target: { value: 'Within scope' }
  })
  fireEvent.click(accept)
  expect(handlers.onResolve).toHaveBeenCalledWith('subtask', 'accept', 'Within scope')
  fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
  expect(handlers.onResolve).toHaveBeenCalledWith('subtask', 'reject', 'Within scope')
  rerender(<TaskDetail {...props} busy />)
  expect(answer.hasAttribute('disabled')).toBe(true)
  expect(accept.hasAttribute('disabled')).toBe(true)
  rerender(
    <TaskDetail
      {...props}
      busy={false}
      messages={props.messages.map((m) => ({ ...m, pending: false }))}
    />
  )
  expect(screen.queryByRole('textbox')).toBeNull()
})

it('renders empty Attempt, submission and timeline states', () => {
  render(<TaskDetail task={task} attempts={[]} messages={[]} busy={false} {...actions()} />)
  expect(screen.getByText('No Attempts yet.')).toBeTruthy()
  expect(screen.getByText('No Submission yet.')).toBeTruthy()
  expect(screen.getByText('No messages yet.')).toBeTruthy()
})
