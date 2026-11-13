// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import {
  attempt,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { readVerdictRecord } from '../../../../shared/axiom-contract/verdict-record'
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
  busy: false,
  onAnswer: vi.fn(),
  onResolve: vi.fn(),
  onOpenWorktree: vi.fn(),
  onSelectTask: vi.fn()
})
const resolution = {
  verdict: 'PASS' as const,
  rationale: 'Reviewed the evidence',
  criteria: [1],
  by: 'user',
  at: '2026-11-13T12:03:00Z'
}

it('shows the disposition of a resolution with its gloss', () => {
  const p = props()
  const { rerender } = render(<TaskDetail {...p} />)
  for (const [disposition, gloss] of [
    ['fixed', 'sent back to be fixed'],
    ['rejected', 'the flag was wrong'],
    ['intentional', 'the flagged change is intended'],
    ['not_worth', 'real, but not worth fixing']
  ]) {
    rerender(
      <TaskDetail
        {...p}
        runs={[
          {
            ...verificationRun,
            status: 'PASS',
            verdictDetail: { resolution: { ...resolution, disposition } }
          }
        ]}
      />
    )
    const region = screen.getByRole('region', { name: 'Human resolution' })
    expect(within(region).getByText(disposition).className).toContain('font-mono')
    expect(within(region).getByText(gloss)).toBeTruthy()
    expect(region.textContent).toContain(resolution.rationale)
  }
  rerender(
    <TaskDetail
      {...p}
      runs={[{ ...verificationRun, status: 'PASS', verdictDetail: { resolution } }]}
    />
  )
  expect(
    within(screen.getByRole('region', { name: 'Human resolution' })).queryByText('Disposition')
  ).toBeNull()
})

it('asks for a person only on the criteria of a run that waits for one', () => {
  const p = props()
  const acceptance = readVerdictRecord(verificationRun.verdictDetail).acceptance.map((c) => ({
    ...c,
    result: 'human',
    check: { kind: 'human' }
  }))
  const { rerender } = render(<TaskDetail {...p} />)
  for (const status of ['HUMAN_REVIEW', 'SPECIALIST_REVIEW'] as const) {
    rerender(
      <TaskDetail {...p} runs={[{ ...verificationRun, status, verdictDetail: { acceptance } }]} />
    )
    const list = screen.getByRole('list', { name: 'Acceptance criteria' })
    expect(within(list).getAllByText('human · Needs a person')).toHaveLength(2)
    expect(
      within(list)
        .getAllByText('human · Needs a person')
        .every((el) => el.className.includes('text-status-warning'))
    ).toBe(true)
  }
  for (const verdict of ['PASS', 'FAIL'] as const) {
    rerender(
      <TaskDetail
        {...p}
        runs={[
          {
            ...verificationRun,
            status: verdict,
            verdictDetail: { acceptance, resolution: { ...resolution, verdict } }
          }
        ]}
      />
    )
    const list = screen.getByRole('list', { name: 'Acceptance criteria' })
    const items = within(list).getAllByRole('listitem')
    expect(list.textContent).not.toContain('Needs a person')
    expect(items[0].textContent).toContain(`human · ${verdict} · Not named in the resolution`)
    expect(items[1].textContent).toContain(`human · ${verdict} · Named in the resolution`)
    expect(list.querySelector('.text-status-warning')).toBeNull()
  }
  rerender(
    <TaskDetail
      {...p}
      runs={[
        {
          ...verificationRun,
          status: 'CANCELED',
          verdictDetail: {
            acceptance,
            rerun: { rationale: 'Retry', by: 'user', at: resolution.at }
          }
        }
      ]}
    />
  )
  const list = screen.getByRole('list', { name: 'Acceptance criteria' })
  expect(
    within(list).getAllByText('human', { selector: 'span.text-muted-foreground' })
  ).toHaveLength(2)
  expect(list.textContent).not.toContain('Needs a person')
})

it('labels the links of the waiting line and keeps their names', () => {
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
          taskIds: ['upstream'],
          runId: verificationRun.id
        }
      }}
    />
  )
  const wait = screen.getByRole('region', { name: 'Waiting on' })
  expect(within(wait).getByText('Upstream Tasks')).toBeTruthy()
  expect(within(wait).getByText('Verification run')).toBeTruthy()
  const upstream = within(wait).getByRole('button', { name: 'Build the parser' })
  const run = within(wait).getByRole('button', { name: verificationRun.id })
  expect(upstream.querySelector('span')?.className.split(' ')).toContain('underline')
  expect(run.querySelector('span')?.className.split(' ')).toContain('underline')
  fireEvent.click(upstream)
  expect(p.onSelectTask).toHaveBeenCalledWith('upstream')
  fireEvent.click(run)
  expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Verification' }))
})

it('says how many entries of a record could not be read', () => {
  const p = props()
  const { rerender } = render(
    <TaskDetail
      {...p}
      runs={[
        {
          ...verificationRun,
          verdictDetail: {
            checks: [null],
            acceptance: [false],
            evidenceArtifactIds: [4],
            diff: { binary: [5] }
          }
        }
      ]}
    />
  )
  expect(screen.getByText('4 entries of this record could not be read.')).toBeTruthy()
  rerender(<TaskDetail {...p} />)
  expect(screen.queryByText(/entries of this record could not be read/)).toBeNull()
})
