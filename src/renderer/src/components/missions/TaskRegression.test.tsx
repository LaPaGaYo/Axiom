// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { axiomClient } from '@/lib/axiom-client'
import {
  taskWithSpec,
  verificationRun,
  evidenceArtifact
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskIntegration } from '../../../../shared/axiom-contract/integration-batch'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import { TaskRegression } from './TaskRegression'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
const integration: TaskIntegration = {
  batchId: 'batch-regression',
  candidateId: verificationRun.candidateId,
  status: 'PROMOTED',
  baseCommit: '4'.repeat(40),
  mergeCommit: '5'.repeat(40),
  conflicts: [],
  updatedAt: '2026-11-18T12:05:00Z'
}
const task = { ...taskWithSpec, integration }
const earlier: VerificationRunView = {
  ...verificationRun,
  id: 'regression-earlier',
  batchId: integration.batchId,
  status: 'INCONCLUSIVE',
  verifier: 'IntegrationController',
  verdictDetail: { phase: 'verdict', verdict: 'INCONCLUSIVE', reason: 'environment', checks: [] }
}
const later: VerificationRunView = {
  ...earlier,
  id: 'regression-later',
  status: 'PASS',
  createdAt: '2026-11-18T12:00:00Z',
  startedAt: '2026-11-18T12:00:00Z',
  finishedAt: '2026-11-18T12:00:02Z',
  updatedAt: '2026-11-18T12:00:02Z',
  verdictDetail: {
    phase: 'verdict',
    verdict: 'PASS',
    reason: 'checks_passed',
    verdictArtifactId: evidenceArtifact.meta.id,
    checks: [
      {
        index: 0,
        source: 'gate',
        command: 'pnpm test:integration',
        result: 'pass',
        exitCode: 0,
        durationMs: 20,
        criteria: [],
        failures: []
      }
    ]
  }
}
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('renders nothing when the Task has no batch', () => {
  const { container } = render(<TaskRegression task={taskWithSpec} regressionRuns={[later]} />)
  expect(container.childElementCount).toBe(0)
})

it('shows the batch status with its base and merge commit', () => {
  const { rerender } = render(<TaskRegression task={task} />)
  const section = screen.getByRole('region', { name: 'Merged-tree regression' })
  const status = section.querySelector('[data-integration-status="PROMOTED"]')
  expect(status?.textContent).toContain('Promoted')
  expect(status?.textContent).toContain('PROMOTED')
  expect(within(section).getByText('4444444').getAttribute('title')).toBe(integration.baseCommit)
  expect(within(section).getByText('5555555').getAttribute('title')).toBe(integration.mergeCommit)
  rerender(
    <TaskRegression
      task={{ ...task, integration: { ...integration, status: 'FAILED', mergeCommit: null } }}
    />
  )
  expect(within(section).getByText('Regression failed')).toBeTruthy()
  expect(section.querySelector('[data-integration-status="FAILED"]')?.textContent).toContain(
    'FAILED'
  )
  expect(within(section).getByText('—')).toBeTruthy()
})

it('lists the conflicting files of a conflicted batch', () => {
  const conflict = {
    ...integration,
    status: 'CONFLICT' as const,
    mergeCommit: null,
    conflicts: ['src/[redacted].ts', 'src/[redacted].ts']
  }
  const { rerender } = render(<TaskRegression task={{ ...task, integration: conflict }} />)
  const list = screen.getByRole('list', { name: 'Conflicting files' })
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
  ).toEqual(conflict.conflicts)
  expect(screen.queryByText(/At most/)).toBeNull()
  expect(screen.getByText('No regression run for this batch yet.')).toBeTruthy()
  const conflicts = Array.from({ length: 200 }, (_, index) => `src/file-${index}.ts`)
  rerender(<TaskRegression task={{ ...task, integration: { ...conflict, conflicts } }} />)
  expect(
    within(list)
      .getAllByRole('listitem')
      .map((item) => item.textContent)
  ).toEqual(conflicts)
  expect(screen.getByText('At most 200 files are recorded; there may be more.')).toBeTruthy()
})

it('shows the runs of the batch newest first with the checks of the newest run', async () => {
  vi.mocked(axiomClient.readArtifact).mockResolvedValue({
    ...evidenceArtifact,
    contentBase64: btoa(
      JSON.stringify({
        checks: [
          {
            index: 0,
            command: 'pnpm test:integration',
            result: 'pass',
            excerpt: 'Merged checks passed'
          }
        ]
      })
    )
  })
  const { rerender } = render(<TaskRegression task={task} regressionRuns={[earlier, later]} />)
  const table = screen.getByRole('table', { name: 'Regression runs' })
  const rows = within(table).getAllByRole('row').slice(1)
  expect(rows).toHaveLength(2)
  expect(rows[0]?.textContent).toContain(later.id)
  expect(rows[1]?.textContent).toContain(earlier.id)
  expect(rows[0]?.textContent).toContain('checks_passed')
  expect(rows[0]?.textContent).toContain('2 s')
  expect(rows[0]?.querySelector('time')?.getAttribute('dateTime')).toBe(later.startedAt)
  const checks = screen.getByRole('table', { name: 'Regression checks' })
  expect(within(checks).getByText('pnpm test:integration')).toBeTruthy()
  expect(within(checks).getByText('pass')).toBeTruthy()
  expect(screen.queryByRole('table', { name: 'Checks' })).toBeNull()
  fireEvent.click(within(checks).getByRole('button', { name: 'Show output #0' }))
  expect(await within(checks).findByText('Merged checks passed')).toBeTruthy()
  expect(axiomClient.readArtifact).toHaveBeenCalledWith({ id: evidenceArtifact.meta.id })
  rerender(<TaskRegression task={task} regressionRuns={[earlier]} />)
  expect(screen.queryByText('Merged checks passed')).toBeNull()
})

it('leaves out runs of another batch', () => {
  const other = { ...later, id: 'regression-other', batchId: 'other-batch' }
  const { rerender } = render(<TaskRegression task={task} regressionRuns={[earlier, other]} />)
  expect(screen.getByText(earlier.id)).toBeTruthy()
  expect(screen.queryByText(other.id)).toBeNull()
  expect(screen.queryByText('pnpm test:integration')).toBeNull()
  rerender(<TaskRegression task={task} regressionRuns={[other]} />)
  expect(screen.queryByRole('table', { name: 'Regression runs' })).toBeNull()
  expect(screen.getByText('No regression run for this batch yet.')).toBeTruthy()
})

it('says so when the regression runs could not be read', () => {
  render(<TaskRegression task={task} regressionRuns={[later]} regressionError />)
  expect(screen.getByText('Regression runs could not be read. Refresh to try again.')).toBeTruthy()
  expect(screen.queryByRole('table', { name: 'Regression runs' })).toBeNull()
})

it('has no control to resolve or rerun a regression', () => {
  render(<TaskRegression task={task} regressionRuns={[earlier, later]} />)
  const section = screen.getByRole('region', { name: 'Merged-tree regression' })
  const buttons = within(section).getAllByRole('button')
  expect(buttons).toHaveLength(1)
  expect(buttons.every((button) => /^Show output #\d+$/.test(button.textContent ?? ''))).toBe(true)
  expect(section.querySelector('form')).toBeNull()
})
