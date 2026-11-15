// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attempt,
  reviewPendingItem,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type {
  AcceptanceCriterion,
  TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'
import { validateTaskAcceptance } from '../../../../shared/axiom-contract/plan-proposal'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
afterEach(cleanup)

it('says before sending that a criterion holds a secret', () => {
  const criterion: AcceptanceCriterion = {
    text: 'Checks pass',
    check: { kind: 'command', command: 'node check.js' }
  }
  const spec: TaskSpec = {
    ...taskWithSpec.spec,
    acceptanceCriteria: [criterion],
    requiredEvidence: []
  }
  const onAdjustTask = vi.fn(async () => false)
  render(
    <TaskDetail
      task={taskWithSpec}
      taskSpec={spec}
      attempts={[attempt]}
      messages={[]}
      runs={[verificationRun]}
      pendingItems={[
        {
          ...reviewPendingItem,
          kind: 'task_blocked',
          objectId: taskWithSpec.id,
          reason: 'candidate_disputed',
          actions: ['axiom.task.adjust', 'axiom.verification.rerun']
        }
      ]}
      busy={false}
      onAnswer={vi.fn()}
      onResolve={vi.fn()}
      onOpenWorktree={vi.fn()}
      onAdjustTask={onAdjustTask}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Task' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Replace acceptance criteria' }))
  fireEvent.change(screen.getByRole('textbox', { name: 'Rationale' }), {
    target: { value: 'Correct the criteria.' }
  })
  const secret = ['ghp', '_', 'x'.repeat(30)].join('')
  for (const field of ['text', 'command'] as const) {
    const command = field === 'command' ? `node check.js ${secret}` : 'node check.js'
    const draft: AcceptanceCriterion = {
      text: field === 'text' ? `Remove ${secret}` : criterion.text,
      check: { kind: 'command', command }
    }
    fireEvent.change(screen.getByRole('textbox', { name: 'Text of criterion 1' }), {
      target: { value: draft.text }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Command of criterion 1' }), {
      target: { value: command }
    })
    const input = screen.getByRole('textbox', {
      name: field === 'text' ? 'Text of criterion 1' : 'Command of criterion 1'
    })
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const path = [
      'task',
      'acceptanceCriteria',
      0,
      ...(field === 'text' ? ['text'] : ['check', 'command'])
    ]
    const issue = validateTaskAcceptance({ ...spec, acceptanceCriteria: [draft] }, ['task']).find(
      (issue) => JSON.stringify(issue.path) === JSON.stringify(path)
    )
    expect(issue).toMatchObject({ code: 'secret_in_criterion', path })
    const description = document.getElementById(input.getAttribute('aria-describedby')!)
    expect(description?.textContent).toBe(issue?.message)
    expect(input.closest('li')?.contains(description)).toBe(true)
    expect(description?.textContent).not.toContain(secret)
    const apply = screen.getByRole('button', { name: 'Apply adjustment' })
    expect(apply.hasAttribute('disabled')).toBe(true)
    fireEvent.click(apply)
    expect(onAdjustTask).not.toHaveBeenCalled()
  }
})
