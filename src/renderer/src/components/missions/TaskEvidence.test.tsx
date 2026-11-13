// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { axiomClient } from '@/lib/axiom-client'
import {
  attempt,
  message,
  verificationRun,
  missionUsage,
  evidenceArtifact
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskWaitingOn } from '../../../../shared/axiom-contract/task-waiting-on'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { TaskDetail } from './TaskDetail'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
afterEach(cleanup)
beforeEach(() => {
  vi.mocked(axiomClient.readArtifact).mockReset()
})
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
  tasks: [task],
  attempts: [attempt],
  messages: [{ ...message, pending: false }],
  busy: false,
  runs: [verificationRun],
  usage: missionUsage.tasks[0],
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onOpenWorktree: vi.fn(),
  onSelectTask: vi.fn()
})
const verification = () => screen.getByRole('region', { name: 'Verification' })
const wait = () => screen.getByRole('region', { name: 'Waiting on' })
const checks = () => within(verification()).getByRole('table', { name: 'Checks' })
const criteria = () => within(verification()).getByRole('list', { name: 'Acceptance criteria' })
const record = (verdictDetail: VerificationRunView['verdictDetail']) => ({
  ...verificationRun,
  verdictDetail
})

it('shows what a Task waits on in the Control Plane words with a gloss', () => {
  const cases: [TaskWaitingOn['on'], string, string][] = [
    ['none', 'future_reason', 'No wait is recorded.'],
    ['mission', 'PAUSED', 'Waiting on the Mission or its plan.'],
    ['dependency', 'upstream_not_integrated', 'Waiting for upstream Tasks to be integrated.'],
    ['question', 'question', 'Waiting for an answer to a question.'],
    ['approval', 'approval', 'Waiting for an approval.'],
    ['budget', 'future_budget', 'A budget limit is holding this Task.'],
    ['admission', 'future_admission', 'Waiting for admission to execution.'],
    ['verification', 'QUEUED', 'Waiting on verification.'],
    ['integration', 'integration_queue', 'Waiting in the integration queue.'],
    ['human', 'acceptance_human', 'Waiting for a person to review or resolve this Task.'],
    ['running', 'attempt_running', 'An Attempt is running.'],
    ['dependency', 'upstream_canceled', 'An upstream Task was canceled.'],
    ['budget', 'budget_exhausted', 'The Mission budget is exhausted.'],
    ['budget', 'task_tokens', 'The Task token budget is exhausted.'],
    ['budget', 'token_budget_exhausted', 'The Task token budget is exhausted.'],
    ['budget', 'task_attempts', 'The Task Attempt budget is exhausted.'],
    ['budget', 'retry_budget_exhausted', 'The Task Attempt budget is exhausted.'],
    ['admission', 'backoff', 'Waiting until the recorded retry time.'],
    ['admission', 'concurrency', 'Waiting for execution capacity.'],
    [
      'admission',
      'no_eligible_provider',
      'No eligible provider was available at the last admission check.'
    ],
    ['admission', 'next_round', 'Waiting for the next admission round.'],
    ['none', 'integrated', 'This Task is integrated.'],
    ['none', 'canceled', 'This Task was canceled.']
  ]
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  expect(screen.queryByRole('region', { name: 'Waiting on' })).toBeNull()
  for (const [on, reason, gloss] of cases) {
    rerender(<TaskDetail {...p} task={{ ...task, waitingOn: { on, reason, person: false } }} />)
    expect(within(wait()).getByText(`${on} · ${reason}`).className).toContain('font-mono')
    expect(within(wait()).getByText(gloss)).toBeTruthy()
  }
  rerender(
    <TaskDetail
      {...p}
      task={{
        ...task,
        waitingOn: {
          on: 'budget',
          reason: 'task_tokens',
          person: true,
          missionStatus: 'EXECUTING',
          seq: 2,
          budget: { scope: 'task', dimension: 'maxTokens', used: 300, limit: 250 },
          until: '2026-11-13T12:05:00Z',
          runId: verificationRun.id
        }
      }}
    />
  )
  for (const text of ['EXECUTING', 'maxTokens', '300 of 250', 'Attempt 2']) {
    expect(wait().textContent).toContain(text)
  }
  expect(wait().querySelector('time')?.dateTime).toBe('2026-11-13T12:05:00Z')
  fireEvent.click(within(wait()).getByRole('button', { name: verificationRun.id }))
  expect(verification().contains(document.activeElement)).toBe(true)
})

it('marks a wait that needs a person without relying on colour', () => {
  const p = props()
  const waitingOn: TaskWaitingOn = { on: 'human', reason: 'acceptance_human', person: true }
  const { rerender } = render(<TaskDetail {...p} task={{ ...task, waitingOn }} />)
  expect(within(wait()).getByText('Needs a person').className).toContain('text-status-warning')
  expect(wait().textContent).toContain('acceptance_human')
  rerender(<TaskDetail {...p} task={{ ...task, waitingOn: { ...waitingOn, person: false } }} />)
  expect(within(wait()).queryByText('Needs a person')).toBeNull()
  expect(wait().className).toContain('text-muted-foreground')
  expect(wait().querySelector('[data-slot="badge"]')).toBeNull()
})

it('names the upstream Tasks of a waiting Task by title', () => {
  const p = props()
  render(
    <TaskDetail
      {...p}
      tasks={[task, { ...task, id: 'upstream', title: 'Build the parser' }]}
      task={{
        ...task,
        waitingOn: {
          on: 'dependency',
          reason: 'upstream_not_integrated',
          person: false,
          taskIds: ['upstream']
        }
      }}
    />
  )
  fireEvent.click(within(wait()).getByRole('button', { name: 'Build the parser' }))
  expect(p.onSelectTask).toHaveBeenCalledWith('upstream')
})

it('lists the verification runs of a Task newest first', () => {
  const old = {
    ...verificationRun,
    id: 'old-run',
    status: 'FAIL' as const,
    createdAt: '2026-11-12T12:00:00Z'
  }
  render(<TaskDetail {...props()} runs={[old, verificationRun]} />)
  const rows = within(verification())
    .getByRole('table', { name: 'Verification runs' })
    .querySelectorAll<HTMLTableRowElement>('tbody tr')
  expect(rows).toHaveLength(2)
  expect(rows[0].textContent).toContain(verificationRun.id)
  expect(rows[0].getAttribute('aria-selected')).toBe('true')
  for (const text of ['acceptance_human', 'aaaaaaa', 'VerificationService', '2 s']) {
    expect(rows[0].textContent).toContain(text)
  }
  expect(rows[0].querySelector('[title]')?.getAttribute('title')).toBe(
    verificationRun.candidateCommitSha
  )
  fireEvent.keyDown(rows[1], { key: 'Enter' })
  expect(rows[1].getAttribute('aria-selected')).toBe('true')
  fireEvent.keyDown(rows[0], { key: ' ' })
  expect(rows[0].getAttribute('aria-selected')).toBe('true')
  fireEvent.click(rows[1])
  expect(rows[1].getAttribute('aria-selected')).toBe('true')
})

it('shows the checks of a run with their commands verbatim', () => {
  const command = 'pnpm test "<script>do not execute</script>"'
  render(
    <TaskDetail
      {...props()}
      runs={[
        record({
          verdict: 'FAIL',
          reason: 'checks_failed',
          checks: [
            {
              index: 0,
              source: 'setup',
              command: 'pnpm prepare',
              criteria: [],
              result: 'pass',
              exitCode: 0,
              durationMs: 25,
              failures: []
            },
            {
              index: 1,
              source: 'evidence',
              command,
              criteria: [0],
              result: 'fail',
              reason: 'test_failure',
              exitCode: 1,
              durationMs: 50,
              failures: ['parser > preserves <value>']
            },
            {
              index: 2,
              source: 'gate',
              command: 'pnpm lint',
              criteria: [],
              result: 'skipped',
              reason: 'setup_failed',
              exitCode: null,
              durationMs: 0,
              failures: []
            }
          ]
        })
      ]}
    />
  )
  const rows = checks().querySelectorAll<HTMLTableRowElement>('tbody tr')
  expect(rows).toHaveLength(3)
  expect(rows[0].textContent).toContain('pass')
  expect(rows[0].textContent).toContain('25 ms')
  expect(rows[1].textContent).toContain(command)
  expect(rows[1].textContent).toContain('parser > preserves <value>')
  expect(rows[1].textContent).toContain('test_failure')
  expect(within(rows[1]).getByText('fail').className).toContain('text-destructive')
  expect(within(rows[1]).getByText(command).className).toContain('font-mono')
  expect(within(rows[1]).getByText('1', { selector: 'td' })).toBeTruthy()
  expect(rows[2].textContent).toContain('skipped')
  expect(rows[2].textContent).toContain('setup_failed')
  expect(checks().querySelector('script')).toBeNull()
})

it('shows each acceptance criterion with its result and how it was checked', () => {
  render(
    <TaskDetail
      {...props()}
      runs={[
        record({
          acceptance: [
            {
              index: 0,
              text: 'Command proof',
              check: { kind: 'command', command: 'pnpm test --offline' },
              result: 'pass',
              checkIndexes: [4],
              artifactIds: []
            },
            {
              index: 1,
              text: 'Report proof',
              check: { kind: 'artifact', artifactKind: 'evidence' },
              result: 'fail',
              checkIndexes: [],
              artifactIds: ['report-artifact']
            },
            {
              index: 2,
              text: '<b>Human proof</b>',
              check: { kind: 'human' },
              result: 'human',
              checkIndexes: [],
              artifactIds: []
            }
          ]
        })
      ]}
    />
  )
  const rows = within(criteria()).getAllByRole('listitem')
  expect(rows).toHaveLength(3)
  for (const text of ['Command proof', 'command', 'pnpm test --offline', 'pass', '#4']) {
    expect(rows[0].textContent).toContain(text)
  }
  for (const text of ['Report proof', 'artifact', 'evidence', 'report-artifact', 'fail']) {
    expect(rows[1].textContent).toContain(text)
  }
  expect(rows[2].textContent).toContain('<b>Human proof</b>')
  expect(rows[2].textContent).toContain('human')
  expect(criteria().querySelector('b')).toBeNull()
})

it('shows the diff gate findings of a run', () => {
  const p = props()
  const { rerender } = render(
    <TaskDetail
      {...p}
      runs={[
        record({
          diff: {
            changedPaths: 9,
            scopeViolations: ['outside.ts'],
            dangerous: [{ path: 'package.json', pattern: '**/package.json' }],
            secrets: [
              { path: 'config.txt', pattern: 'token-pattern', matchedText: 'NEVER_RENDER' }
            ],
            tampering: [{ path: 'test.ts', rule: 'assertion_removed', count: 2 }],
            generated: ['dist/app.js'],
            binary: ['image.png'],
            ignoredScopeEntries: ['../bad'],
            patchComplete: false,
            counts: {
              scopeViolations: 60,
              dangerous: 1,
              secrets: 1,
              tampering: 1,
              generated: 1,
              binary: 1,
              ignoredScopeEntries: 1
            }
          }
        })
      ]}
    />
  )
  const gate = screen.getByRole('region', { name: 'Diff gate' })
  for (const text of [
    'Changed paths: 9',
    'outside.ts',
    '60 total',
    'package.json',
    'token-pattern',
    'assertion_removed',
    'dist/app.js',
    'image.png',
    '../bad',
    'Patch complete: No'
  ]) {
    expect(gate.textContent).toContain(text)
  }
  expect(gate.textContent).not.toContain('NEVER_RENDER')
  rerender(<TaskDetail {...p} runs={[record({ diff: { error: 'diff_unavailable' } })]} />)
  expect(screen.getByRole('region', { name: 'Diff gate' }).textContent).toContain(
    'diff_unavailable'
  )
})

it('shows who resolved a human review and why', () => {
  const p = props()
  const resolved = {
    ...verificationRun,
    status: 'PASS' as const,
    verdictDetail: {
      ...verificationRun.verdictDetail,
      resolution: {
        verdict: 'PASS',
        rationale: 'Reviewed <b>carefully</b>.',
        criteria: [1],
        by: 'user',
        at: '2026-11-13T12:10:00Z'
      }
    }
  }
  const { rerender } = render(<TaskDetail {...p} runs={[resolved]} />)
  const resolution = screen.getByRole('region', { name: 'Human resolution' })
  for (const text of ['user', 'PASS', 'Reviewed <b>carefully</b>.', '#1', 'The example is clear']) {
    expect(resolution.textContent).toContain(text)
  }
  expect(resolution.querySelector('time')?.dateTime).toBe('2026-11-13T12:10:00Z')
  expect(resolution.querySelector('b')).toBeNull()
  expect(verification().textContent).toContain('Resolved by a person')
  expect(verification().textContent).toContain('INCONCLUSIVE')
  expect(verification().textContent).toContain('acceptance_human')
  expect(criteria().textContent).toContain('human')
  expect(verification().textContent).toContain('v22.0.0')
  expect(verification().textContent).toContain('evidence-1')
  rerender(
    <TaskDetail
      {...p}
      runs={[
        record({
          rerun: { rationale: 'Criteria corrected.', by: 'user', at: '2026-11-13T13:00:00Z' }
        })
      ]}
    />
  )
  expect(screen.getByRole('region', { name: 'Rerun' }).textContent).toContain('Criteria corrected.')
})

it('loads the output excerpt of a check from the evidence Artifact on demand', async () => {
  const p = props()
  vi.mocked(axiomClient.readArtifact).mockResolvedValue({
    ...evidenceArtifact,
    contentBase64: btoa(
      JSON.stringify({
        checks: [
          {
            index: 0,
            source: 'evidence',
            command: verificationRun.commands[0],
            result: 'fail',
            excerpt: '<script>failure</script>'
          }
        ]
      })
    )
  })
  render(<TaskDetail {...p} />)
  expect(axiomClient.readArtifact).not.toHaveBeenCalled()
  const open = () =>
    fireEvent.click(within(checks()).getByRole('button', { name: 'Show output #0' }))
  const close = () =>
    fireEvent.click(within(checks()).getByRole('button', { name: 'Hide output #0' }))
  open()
  const excerpt = await screen.findByText('<script>failure</script>')
  expect(excerpt.tagName).toBe('PRE')
  expect(excerpt.querySelector('script')).toBeNull()
  expect(axiomClient.readArtifact).toHaveBeenCalledWith({ id: 'evidence-1' })
  close()
  vi.mocked(axiomClient.readArtifact).mockResolvedValue(evidenceArtifact)
  open()
  expect(await screen.findByText('This Artifact holds no excerpt for this check.')).toBeTruthy()
  expect(axiomClient.readArtifact).toHaveBeenCalledTimes(2)
  close()
  vi.mocked(axiomClient.readArtifact).mockRejectedValue(new Error('offline'))
  await act(async () => open())
  expect(await screen.findByText('The evidence Artifact could not be read.')).toBeTruthy()
})

it('opens the verification record from a verified stage in one click', () => {
  const old = { ...verificationRun, id: 'old-run' }
  const pass = { ...verificationRun, status: 'PASS' as const }
  render(<TaskDetail {...props()} task={{ ...task, stage: 'VERIFIED' }} runs={[old, pass]} />)
  const rows = within(verification())
    .getByRole('table', { name: 'Verification runs' })
    .querySelectorAll<HTMLTableRowElement>('tbody tr')
  fireEvent.click(rows[1])
  const stage = screen.getByRole('button', { name: 'Verified' })
  expect(stage.getAttribute('data-task-stage')).toBe('VERIFIED')
  expect(stage.querySelector('span')?.className).toContain('text-status-success')
  fireEvent.click(stage)
  expect(rows[0].getAttribute('aria-selected')).toBe('true')
  expect(verification().contains(document.activeElement)).toBe(true)
})

it('shows no success colour without a passing run and never styles a submitted Task as done', () => {
  const p = props()
  const { rerender, container } = render(
    <TaskDetail {...p} task={{ ...task, stage: 'VERIFIED' }} runs={[]} />
  )
  expect(screen.getByText('Passing verification record missing.')).toBeTruthy()
  expect(
    screen.getByRole('button', { name: 'Verified' }).querySelector('span')?.className
  ).not.toContain('status-success')
  expect(verification().textContent).toContain('No verification runs yet.')
  for (const stage of ['VERIFIED', 'INTEGRATED'] as const) {
    rerender(
      <TaskDetail
        {...p}
        task={{ ...task, stage }}
        runs={[{ ...verificationRun, status: 'PASS' }]}
      />
    )
    expect(
      container.querySelector('[data-task-stage] span')?.className ??
        container.querySelector('[data-task-stage]')?.className
    ).toContain('status-success')
    rerender(
      <TaskDetail
        {...p}
        task={{ ...task, stage }}
        runs={[{ ...verificationRun, status: 'PASS', id: 'older' }, verificationRun]}
      />
    )
    expect(
      container.querySelector('[data-task-stage] span')?.className ??
        container.querySelector('[data-task-stage]')?.className
    ).not.toContain('status-success')
  }
  for (const stage of ['SUBMITTED', 'VERIFYING'] as const) {
    rerender(<TaskDetail {...p} task={{ ...task, stage }} runs={[]} />)
    expect(
      container.querySelector('[data-task-stage] span')?.className ??
        container.querySelector('[data-task-stage]')?.className
    ).not.toContain('status-success')
  }
  rerender(<TaskDetail {...p} task={{ ...task, stage: 'SUBMITTED' }} runs={[]} />)
  expect(screen.getByText('Submitted, awaiting verification')).toBeTruthy()
  rerender(<TaskDetail {...p} task={{ ...task, stage: 'VERIFIED' }} runs={[]} verificationError />)
  expect(verification().textContent).toContain(
    'Verification could not be read. Refresh to try again.'
  )
})

it('shows the tokens of each Attempt and the Task total against its cap', () => {
  render(
    <TaskDetail
      {...props()}
      attempts={[attempt, { ...attempt, seq: 2, attemptId: 'unmeasured' }]}
    />
  )
  const table = screen.getByRole('table', { name: 'Attempts' })
  const rows = table.querySelectorAll<HTMLTableRowElement>('tbody tr')
  expect(rows).toHaveLength(2)
  expect(within(table).getByRole('columnheader', { name: 'New tokens' })).toBeTruthy()
  expect(rows[0].textContent).toContain('350')
  expect(rows[0].textContent).toContain('partial')
  expect(rows[1].textContent).toContain('Not measured')
  const total = screen.getByText('Task tokens: 350 of 1000')
  expect(table.contains(total)).toBe(false)
})
