// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attempt,
  policy,
  reviewPendingItem,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { MissionPendingItem } from '../../../../shared/axiom-contract/mission-pending'
import type {
  AcceptanceCriterion,
  TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'
import { ArtifactKind, PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { resolveAcceptance } from '../../../../shared/axiom-contract/acceptance'
import { TaskAdjustParams } from '../../../../shared/axiom-contract/task-params'
import { validateTaskAcceptance } from '../../../../shared/axiom-contract/plan-proposal'
import {
  evidenceCommandMessage,
  validateAcceptanceCommands
} from '../../../../shared/axiom-contract/evidence-commands'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
afterEach(cleanup)
const blocked: MissionPendingItem = {
  ...reviewPendingItem,
  kind: 'task_blocked',
  objectId: taskWithSpec.id,
  reason: 'candidate_disputed',
  actions: ['axiom.task.adjust', 'axiom.verification.rerun']
}
const command: AcceptanceCriterion = {
  text: 'Checks pass',
  check: { kind: 'command', command: 'pnpm test' }
}
const spec: TaskSpec = { ...taskWithSpec.spec, acceptanceCriteria: [command], requiredEvidence: [] }
const props = () => ({
  task: taskWithSpec,
  taskSpec: spec,
  attempts: [attempt],
  messages: [],
  runs: [verificationRun],
  pendingItems: [blocked],
  busy: false,
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onOpenWorktree: vi.fn(),
  onAdjustTask: vi.fn(async () => false)
})
const region = () => screen.getByRole('region', { name: 'Current acceptance criteria' })
const rows = () =>
  within(screen.getByRole('list', { name: 'New acceptance criteria' })).getAllByRole('listitem')
const replace = () => screen.getByRole('checkbox', { name: 'Replace acceptance criteria' })
const apply = () => screen.getByRole('button', { name: 'Apply adjustment' })
const field = (name: string) => screen.getByRole('textbox', { name })
const fill = (name: string, value: string) => fireEvent.change(field(name), { target: { value } })
function open() {
  fireEvent.click(screen.getByRole('button', { name: 'Adjust Task' }))
  return screen.getByRole('form', { name: 'Adjust Task' })
}
function proof(number: number, value: string) {
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: `Proof of criterion ${number}` })).getByRole(
      'radio',
      { name: value }
    )
  )
}
const rules = VerificationRulesSchema.parse({
  evidenceCommands: { allowedPrograms: ['node'] },
  setupCommands: ['pnpm setup']
})
const restrictedPolicy = PolicySchema.parse({ ...policy, verificationRules: rules })
function commandMessage(value: string) {
  const issue = validateAcceptanceCommands(
    [{ text: 'Checks', check: { kind: 'command', command: value } }],
    rules
  )[0]
  expect(issue).toBeTruthy()
  return evidenceCommandMessage(issue, issue.command)
}
function described(name: string, text: string) {
  const input = field(name)
  expect(input.getAttribute('aria-invalid')).toBe('true')
  const description = document.getElementById(input.getAttribute('aria-describedby')!)
  expect(description?.textContent).toBe(text)
  expect(input.closest('li')?.contains(description)).toBe(true)
}

it('shows the acceptance criteria of a Task as they are now', () => {
  const p = props()
  const mixed: TaskSpec = {
    ...spec,
    acceptanceCriteria: [
      { text: '  Current command  ', check: { kind: 'command', command: '  pnpm test  ' } },
      { text: 'Current Artifact', check: { kind: 'artifact', artifactKind: 'evidence' } },
      { text: 'Current human', check: { kind: 'human' } },
      'Legacy human'
    ],
    requiredEvidence: ['node legacy-check.js']
  }
  const { rerender } = render(<TaskDetail {...p} taskSpec={mixed} />)
  const current = region()
  expect(
    within(current).getByRole('heading', { name: 'Current acceptance criteria', level: 3 })
  ).toBeTruthy()
  const items = within(
    within(current).getByRole('list', { name: 'Current acceptance criteria' })
  ).getAllByRole('listitem')
  expect(items).toHaveLength(5)
  resolveAcceptance(mixed).forEach((criterion, index) => {
    expect(items[index].textContent).toContain(criterion.text)
    expect(within(items[index]).getByText(criterion.check.kind, { exact: true })).toBeTruthy()
    if (criterion.check.kind === 'command') {
      expect(items[index].querySelector('code')?.textContent).toBe(criterion.check.command)
      expect(items[index].textContent).toContain(
        'Verification runs this command from the repository root on the candidate and requires exit 0.'
      )
    } else if (criterion.check.kind === 'artifact') {
      expect(items[index].textContent).toContain('evidence')
      expect(items[index].textContent).toContain(
        'The submission must reference a readable, non-empty Artifact of the declared kind, when given.'
      )
    } else {
      expect(items[index].textContent).toContain('A person confirms this criterion.')
    }
  })
  expect(within(current).getAllByText('Human check', { exact: true })).toHaveLength(2)
  expect(screen.getAllByRole('list', { name: 'Acceptance criteria' })).toHaveLength(1)
  expect(current.contains(screen.getByRole('list', { name: 'Acceptance criteria' }))).toBe(false)
  expect(screen.queryByRole('textbox')).toBeNull()
  rerender(<TaskDetail {...p} taskSpec={spec} />)
  expect(region().textContent).toContain(command.text)
  expect(region().querySelector('code')?.textContent).toBe('pnpm test')
  for (const criterion of resolveAcceptance(mixed)) {
    expect(region().textContent).not.toContain(criterion.text)
  }
  rerender(<TaskDetail {...p} taskSpec={undefined} />)
  expect(
    within(region()).getByText(
      'The acceptance criteria of this Task could not be read. Refresh to try again.'
    )
  ).toBeTruthy()
  expect(within(region()).queryByRole('list')).toBeNull()
  expect(within(region()).queryByRole('alert')).toBeNull()
  expect(within(region()).queryByRole('status')).toBeNull()
})

it('replaces the criteria of a Task from the adjust form', async () => {
  const p = props()
  const mixed: TaskSpec = {
    ...spec,
    acceptanceCriteria: [
      command,
      { text: 'Artifact to remove', check: { kind: 'artifact', artifactKind: 'log' } },
      'Human to change'
    ]
  }
  const { rerender } = render(<TaskDetail {...p} taskSpec={mixed} />)
  const form = open()
  expect(replace().getAttribute('aria-checked')).toBe('false')
  expect(document.activeElement).toBe(field('Allowed paths to add'))
  expect(within(form).queryByRole('list', { name: 'New acceptance criteria' })).toBeNull()
  fireEvent.click(replace())
  expect(rows()).toHaveLength(3)
  expect(field('Text of criterion 1')).toHaveProperty('value', command.text)
  expect(field('Command of criterion 1')).toHaveProperty('value', 'pnpm test')
  expect(field('Text of criterion 1').tagName).toBe('TEXTAREA')
  expect(field('Command of criterion 1').tagName).toBe('INPUT')
  expect(field('Command of criterion 1').parentElement?.className).toContain('font-mono')
  const artifact = screen.getByRole('radiogroup', { name: 'Artifact kind of criterion 2' })
  expect(
    within(artifact)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label'))
  ).toEqual(['Any kind', ...ArtifactKind.options])
  expect(within(artifact).getByRole('radio', { name: 'log' }).getAttribute('aria-checked')).toBe(
    'true'
  )
  expect(
    within(screen.getByRole('radiogroup', { name: 'Proof of criterion 3' }))
      .getByRole('radio', { name: 'human' })
      .getAttribute('aria-checked')
  ).toBe('true')
  rows().forEach((row, index) =>
    expect(within(form).getByRole('listitem', { name: `Criterion ${index + 1}` })).toBe(row)
  )
  fill('Text of criterion 1', '  Edited check  ')
  fill('Command of criterion 1', '  node check.js  ')
  proof(1, 'human')
  proof(1, 'command')
  expect(field('Command of criterion 1')).toHaveProperty('value', '  node check.js  ')
  proof(3, 'artifact')
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: 'Artifact kind of criterion 3' })).getByRole(
      'radio',
      { name: 'evidence' }
    )
  )
  proof(3, 'human')
  proof(3, 'artifact')
  expect(
    within(screen.getByRole('radiogroup', { name: 'Artifact kind of criterion 3' }))
      .getByRole('radio', { name: 'evidence' })
      .getAttribute('aria-checked')
  ).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Add criterion' }))
  expect(field('Text of criterion 4')).toHaveProperty('value', '')
  expect(field('Command of criterion 4')).toHaveProperty('value', '')
  fill('Text of criterion 4', '  New human  ')
  proof(4, 'human')
  fireEvent.click(screen.getByRole('button', { name: 'Remove criterion 2' }))
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add criterion' }))
  expect(rows()).toHaveLength(3)
  rerender(
    <TaskDetail {...p} taskSpec={{ ...mixed, acceptanceCriteria: [...mixed.acceptanceCriteria] }} />
  )
  rerender(
    <TaskDetail
      {...p}
      taskSpec={{
        ...spec,
        acceptanceCriteria: [{ text: 'Changed underneath', check: { kind: 'human' } }]
      }}
    />
  )
  expect(field('Text of criterion 1')).toHaveProperty('value', '  Edited check  ')
  expect(field('Text of criterion 2')).toHaveProperty('value', 'Human to change')
  expect(field('Text of criterion 3')).toHaveProperty('value', '  New human  ')
  expect(region().textContent).toContain('Changed underneath')
  expect(region().textContent).not.toContain('Edited check')
  rerender(<TaskDetail {...p} taskSpec={mixed} busy />)
  for (const control of [
    replace(),
    ...within(screen.getByRole('group', { name: 'New acceptance criteria' })).getAllByRole(
      'textbox'
    ),
    ...within(screen.getByRole('group', { name: 'New acceptance criteria' })).getAllByRole('radio'),
    ...within(screen.getByRole('group', { name: 'New acceptance criteria' })).getAllByRole('button')
  ]) {
    expect(control.hasAttribute('disabled')).toBe(true)
  }
  rerender(<TaskDetail {...p} taskSpec={mixed} />)
  fill('Rationale', '  Correct the criteria.  ')
  const acceptanceCriteria = [
    { text: 'Edited check', check: { kind: 'command', command: 'node check.js' } },
    { text: 'Human to change', check: { kind: 'artifact', artifactKind: 'evidence' } },
    { text: 'New human', check: { kind: 'human' } }
  ]
  await act(async () => fireEvent.click(apply()))
  expect(p.onAdjustTask).toHaveBeenCalledExactlyOnceWith({
    taskId: p.task.id,
    rationale: 'Correct the criteria.',
    addAllowedPaths: [],
    acceptanceCriteria
  })
  expect(field('Text of criterion 1')).toHaveProperty('value', '  Edited check  ')
  p.onAdjustTask.mockClear()
  fireEvent.click(replace())
  expect(within(form).queryByRole('list', { name: 'New acceptance criteria' })).toBeNull()
  await act(async () => fireEvent.click(apply()))
  expect(p.onAdjustTask).toHaveBeenCalledExactlyOnceWith({
    taskId: p.task.id,
    rationale: 'Correct the criteria.',
    addAllowedPaths: []
  })
  p.onAdjustTask.mockClear()
  fireEvent.click(replace())
  expect(field('Text of criterion 1')).toHaveProperty('value', '  Edited check  ')
  fill('Allowed paths to add', ' src/new.ts ')
  fill('New Attempt limit', '3')
  fill('New token limit', '2000')
  p.onAdjustTask.mockResolvedValue(true)
  await act(async () => fireEvent.click(apply()))
  expect(p.onAdjustTask).toHaveBeenCalledExactlyOnceWith({
    taskId: p.task.id,
    rationale: 'Correct the criteria.',
    addAllowedPaths: ['src/new.ts'],
    maxAttempts: 3,
    maxTokens: 2000,
    acceptanceCriteria
  })
  expect(screen.queryByRole('form')).toBeNull()
})

it('says before sending why new criteria would be refused', () => {
  render(<TaskDetail {...props()} policy={restrictedPolicy} />)
  open()
  fireEvent.click(replace())
  fill('Rationale', 'Fix the plan')
  for (const value of ['git status', 'node check.js | node other.js']) {
    fill('Command of criterion 1', value)
    described('Command of criterion 1', commandMessage(value))
    expect(apply().hasAttribute('disabled')).toBe(true)
  }
  fill('Command of criterion 1', '  pnpm test  ')
  expect(field('Command of criterion 1').getAttribute('aria-describedby')).toBeNull()
  expect(apply().hasAttribute('disabled')).toBe(false)
  fill('Text of criterion 1', '  ')
  described('Text of criterion 1', 'Expected non-empty text')
  expect(apply().hasAttribute('disabled')).toBe(true)
  fill('Text of criterion 1', 'Checks')
  fill('Command of criterion 1', ' ')
  described('Command of criterion 1', 'Expected non-empty text')
  proof(1, 'human')
  const humanSpec = {
    ...spec,
    acceptanceCriteria: [{ text: 'Checks', check: { kind: 'human' as const } }]
  }
  const message = validateTaskAcceptance(humanSpec, ['task'])[0].message
  expect(screen.getByText(message)).toBeTruthy()
  expect(
    screen.getByRole('list', { name: 'New acceptance criteria' }).nextElementSibling?.textContent
  ).toContain(message)
  expect(apply().hasAttribute('disabled')).toBe(true)
  proof(1, 'artifact')
  expect(screen.queryByText(message)).toBeNull()
  expect(apply().hasAttribute('disabled')).toBe(false)
  // The list bound is taken from the contract, not hard-coded by the editor.
  let count = 1
  while (
    TaskAdjustParams.shape.acceptanceCriteria.safeParse(
      Array.from({ length: count }, () => command)
    ).success
  ) {
    count++
  }
  for (let index = 1; index < count; index++) {
    fireEvent.click(screen.getByRole('button', { name: 'Add criterion' }))
  }
  const parsed = TaskAdjustParams.shape.acceptanceCriteria.safeParse(
    Array.from({ length: count }, () => command)
  )
  expect(parsed.success).toBe(false)
  if (!parsed.success) {
    expect(screen.getByText(parsed.error.issues[0].message)).toBeTruthy()
  }
  expect(apply().hasAttribute('disabled')).toBe(true)
})

it('does not check commands when the policy cannot be read or is not valid', () => {
  const missing =
    "The Mission's policy could not be read, so the commands are not checked here. The Control Plane checks them when the adjustment is applied."
  const invalid =
    "The Mission's verification rules are not valid. Verification would end INCONCLUSIVE (policy_invalid) without running a command."
  const defaults =
    'The commands are not checked here. The Control Plane checks them against its default rules when the adjustment is applied.'
  for (const currentPolicy of [
    undefined,
    null,
    PolicySchema.parse({ ...policy, verificationRules: { unknownRule: true } })
  ]) {
    const { unmount } = render(<TaskDetail {...props()} policy={currentPolicy} />)
    open()
    fireEvent.click(replace())
    expect(screen.getByText(currentPolicy ? invalid : missing)).toBeTruthy()
    if (currentPolicy) {
      expect(screen.getByText(defaults)).toBeTruthy()
    }
    fill('Command of criterion 1', 'git status')
    fill('Rationale', 'Correct the plan')
    expect(screen.queryByText(commandMessage('git status'))).toBeNull()
    expect(apply().hasAttribute('disabled')).toBe(false)
    fill('Text of criterion 1', ' ')
    described('Text of criterion 1', 'Expected non-empty text')
    expect(apply().hasAttribute('disabled')).toBe(true)
    fill('Text of criterion 1', 'Human')
    proof(1, 'human')
    expect(
      screen.getByText(
        validateTaskAcceptance(
          { ...spec, acceptanceCriteria: [{ text: 'Human', check: { kind: 'human' } }] },
          ['task']
        )[0].message
      )
    ).toBeTruthy()
    expect(apply().hasAttribute('disabled')).toBe(true)
    unmount()
  }
})

it('does not offer to replace criteria the Control Plane would refuse for retired evidence', async () => {
  const p = props()
  render(<TaskDetail {...p} taskSpec={{ ...spec, requiredEvidence: ['node legacy.js'] }} />)
  const form = open()
  expect(
    within(form).getByText(
      'This Task still lists commands in the retired requiredEvidence field, and the Control Plane refuses to replace the criteria of such a Task (required_evidence_retired).'
    )
  ).toBeTruthy()
  expect(screen.queryByRole('checkbox', { name: 'Replace acceptance criteria' })).toBeNull()
  fill('Rationale', 'Add scope')
  fill('Allowed paths to add', 'src/legacy.ts')
  await act(async () => fireEvent.click(apply()))
  expect(p.onAdjustTask).toHaveBeenCalledExactlyOnceWith({
    taskId: p.task.id,
    rationale: 'Add scope',
    addAllowedPaths: ['src/legacy.ts']
  })
})

it('says what replacing only the criteria does to a blocked Task', () => {
  const text =
    'Replacing only the criteria leaves this Task blocked, so that verification can be rerun on the same Candidate against the new criteria. An adjustment that also carries a path or a limit sends the Task back for another Attempt instead, and is refused when its Attempts are used up.'
  const { rerender } = render(<TaskDetail {...props()} />)
  open()
  fireEvent.click(replace())
  expect(screen.getByText(text)).toBeTruthy()
  fireEvent.click(replace())
  expect(screen.queryByText(text)).toBeNull()
  const items: MissionPendingItem[] = [
    { ...blocked, actions: ['axiom.task.adjust'] },
    { ...reviewPendingItem, actions: ['axiom.task.adjust', 'axiom.verification.rerun'] }
  ]
  for (const item of items) {
    rerender(<TaskDetail {...props()} pendingItems={[item]} />)
    if (!screen.queryByRole('form')) {
      open()
    }
    expect(screen.queryByText(text)).toBeNull()
    fireEvent.click(replace())
    expect(screen.queryByText(text)).toBeNull()
    if (item.kind === 'human_review') {
      expect(
        screen.getByText(
          'The review stays open after an adjustment. Rerun verification to check the same Candidate against the adjusted Task.'
        )
      ).toBeTruthy()
    }
    fireEvent.click(replace())
  }
})
