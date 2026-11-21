// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { axiomClient } from '@/lib/axiom-client'
import { AxiomRpcError } from '@/lib/axiom-rpc-call'
import { evidenceArtifact } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { CompletionReportSchema } from '../../../../shared/axiom-contract/completion-report'
import { FINALIZATION_GATE_IDS } from '../../../../shared/axiom-contract/mission-finalization'
import { MissionFinalization } from './MissionFinalization'

vi.mock('@/lib/axiom-client', () => ({ axiomClient: { readArtifact: vi.fn() } }))
const ready = {
  outcome: 'ready' as const,
  at: '2026-11-20T12:00:00Z',
  targetBranch: 'main',
  targetHead: '1'.repeat(40),
  integrationHead: '2'.repeat(40),
  gate: FINALIZATION_GATE_IDS.map((id, index) => ({
    id,
    pass: true,
    evidence: Array.from({ length: index }, (_, i) => `ref-${i}`)
  })),
  reportArtifactId: 'report-1',
  reportSha256: '3'.repeat(64)
}
const gateLabels = [
  'Every Task is integrated or canceled, and at least one is integrated',
  'The candidate of every integrated Task passed verification',
  'The batch of every integrated Task is promoted and its merged-tree regression passed',
  'The integration branch is at the commit the Control Plane recorded',
  'The integration branch contains the target branch',
  'No question or gate is pending on an unfinished Task and no approval blocks the Mission',
  'Every acceptance criterion of the Goal is covered by an integrated Task',
  'The submission of every integrated Task is on record'
]
const report = CompletionReportSchema.parse({
  version: 1,
  mission: { id: 'mission-1', repoId: 'repo-1', targetBranch: 'main' },
  goal: {
    id: 'goal',
    revision: 1,
    objective: '完成交付',
    constraints: [],
    criteria: [],
    revisions: []
  },
  plans: [],
  tasks: [
    ...['first', 'second'].map((taskId) => ({
      taskId,
      planTaskId: taskId,
      planRevisionId: 'plan',
      title: taskId,
      kind: 'task',
      stage: 'INTEGRATED',
      attempts: [],
      runs: [],
      openQuestions: [],
      candidate: { id: `candidate-${taskId}`, commitSha: '4'.repeat(40), treeSha: '5'.repeat(40) },
      summary: '',
      limitations: [],
      risks: [],
      followUps: [],
      verification: {
        runId: `run-${taskId}`,
        status: 'PASS',
        verifier: 'Verifier',
        toolVersions: {},
        checks: [],
        artifacts: []
      },
      integration: {
        batchId: `batch-${taskId}`,
        baseCommit: '1'.repeat(40),
        mergeCommit: '2'.repeat(40),
        regressionRunId: `regression-${taskId}`,
        regressionStatus: 'PASS'
      }
    })),
    {
      taskId: 'canceled',
      planTaskId: 'third',
      planRevisionId: 'plan',
      title: 'Canceled work',
      kind: 'task',
      stage: 'CANCELED',
      attempts: [],
      runs: [],
      openQuestions: []
    }
  ],
  decisions: [],
  gate: ready.gate,
  commits: { integrationHead: ready.integrationHead, targetHead: ready.targetHead, promoted: [] },
  risks: []
})
function artifact(content = JSON.stringify(report)) {
  const bytes = new TextEncoder().encode(content)
  return {
    meta: {
      ...evidenceArtifact.meta,
      id: ready.reportArtifactId,
      kind: 'completion_report' as const,
      mediaType: 'application/json; charset=utf-8',
      sha256: ready.reportSha256,
      sizeBytes: bytes.length
    },
    contentBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  }
}
const readFailed = 'The completion report could not be read.'
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(axiomClient.readArtifact).mockResolvedValue(artifact())
})
afterEach(cleanup)

it('renders nothing without a finalization record', () => {
  const { container } = render(<MissionFinalization />)
  expect(container.childElementCount).toBe(0)
})

it('shows a ready finalization with its commits and every gate item', () => {
  const { container } = render(<MissionFinalization finalization={ready} />)
  expect(container.querySelector('[data-finalization-outcome="ready"]')?.textContent).toContain(
    'All completion gate items passed'
  )
  expect(screen.getByText('ready')).toBeTruthy()
  expect(container.querySelector('time')?.getAttribute('dateTime')).toBe(ready.at)
  expect(container.querySelector('time')?.textContent).toBe(ready.at)
  expect(screen.getByText(ready.targetBranch)).toBeTruthy()
  for (const head of [ready.targetHead, ready.integrationHead]) {
    expect(screen.getByText(head.slice(0, 7)).getAttribute('title')).toBe(head)
  }
  const rows = within(screen.getByRole('table', { name: 'Completion gate' }))
    .getAllByRole('row')
    .slice(1)
  expect(rows).toHaveLength(8)
  rows.forEach((row, index) => {
    const item = ready.gate[index]
    expect(row.getAttribute('data-gate-item')).toBe(item.id)
    expect(row.getAttribute('data-gate-pass')).toBe('true')
    expect(within(row).getByText(item.id)).toBeTruthy()
    expect(within(row).getByText(gateLabels[index])).toBeTruthy()
    expect(within(row).getByText('Passed', { exact: true })).toBeTruthy()
    expect(within(row).getByText(`${item.evidence.length} reference(s)`)).toBeTruthy()
  })
})

it('shows a stopped finalization with the reason in the Control Plane word and no report line', () => {
  const base = { at: ready.at, targetBranch: ready.targetBranch, outcome: 'stopped' as const }
  const { rerender, container } = render(
    <MissionFinalization
      finalization={{
        ...base,
        reason: 'completion_gate_failed',
        targetHead: ready.targetHead,
        integrationHead: ready.integrationHead,
        gate: ready.gate.map((item) =>
          item.id === 'goal_criteria_covered' ? { ...item, pass: false, detail: '#0, #2' } : item
        )
      }}
    />
  )
  expect(container.querySelector('[data-finalization-outcome="stopped"]')).not.toBeNull()
  expect(screen.getByText('completion_gate_failed')).toBeTruthy()
  expect(screen.getByText('At least one completion gate item did not pass')).toBeTruthy()
  const failed = container.querySelector('[data-gate-pass="false"]')
  expect(failed?.textContent).toContain('Not passed')
  expect(failed?.textContent).toContain('#0, #2')
  expect(screen.queryByRole('button', { name: 'Show report' })).toBeNull()
  expect(screen.queryByText('Report artifact')).toBeNull()
  for (const [reason, gloss] of [
    ['target_branch_not_found', 'The local target branch was not found'],
    [
      'target_branch_moved',
      'The target branch has commits the integration branch does not contain'
    ],
    [
      'integration_head_unexpected',
      'The integration branch is not at the commit the Control Plane recorded'
    ],
    [
      'finalization_unavailable',
      'Finalization could not read the repository or store the report after three tries'
    ]
  ] as const) {
    rerender(
      <MissionFinalization
        finalization={{
          ...base,
          reason,
          ...(reason === 'finalization_unavailable'
            ? {}
            : { integrationHead: ready.integrationHead }),
          ...(reason === 'target_branch_moved' ? { targetHead: ready.targetHead } : {})
        }}
      />
    )
    expect(screen.getByText(reason)).toBeTruthy()
    expect(screen.getByText(gloss)).toBeTruthy()
    expect(screen.getByText('Target head').nextElementSibling?.textContent).toBe(
      reason === 'target_branch_moved' ? ready.targetHead.slice(0, 7) : '—'
    )
    expect(screen.getByText('The completion gate was not evaluated.')).toBeTruthy()
  }
})

it('names the report artifact and its hash and reads nothing until asked', () => {
  render(<MissionFinalization finalization={ready} />)
  expect(screen.getByText(ready.reportArtifactId)).toBeTruthy()
  const hash = screen.getByTestId('completion-report-sha')
  expect(hash.textContent).toBe(ready.reportSha256.slice(0, 12))
  expect(hash.getAttribute('title')).toBe(ready.reportSha256)
  expect(axiomClient.readArtifact).not.toHaveBeenCalled()
})

it('reads and shows the report when asked and hides it again', async () => {
  render(<MissionFinalization finalization={ready} />)
  const button = screen.getByRole('button', { name: 'Show report' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(screen.getByRole('status').textContent).toBe('Loading the report…')
  const section = await screen.findByRole('region', { name: 'Completion report' })
  expect(within(section).getByText(report.goal.objective)).toBeTruthy()
  expect(axiomClient.readArtifact).toHaveBeenCalledExactlyOnceWith({ id: ready.reportArtifactId })
  expect(screen.getByRole('button', { name: 'Hide report' }).getAttribute('aria-expanded')).toBe(
    'true'
  )
  fireEvent.click(screen.getByRole('button', { name: 'Hide report' }))
  expect(screen.queryByRole('region', { name: 'Completion report' })).toBeNull()
  expect(button.getAttribute('aria-expanded')).toBe('false')
})

it('refuses a report whose hash is not the recorded one', async () => {
  const answer = artifact()
  vi.mocked(axiomClient.readArtifact).mockResolvedValue({
    ...answer,
    meta: { ...answer.meta, sha256: '9'.repeat(64) }
  })
  render(<MissionFinalization finalization={ready} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
  expect(
    await screen.findByText('The stored report is not the one this finalization recorded.')
  ).toBeTruthy()
  expect(screen.queryByText(readFailed)).toBeNull()
  expect(screen.queryByRole('region', { name: 'Completion report' })).toBeNull()
})

it('says so when the report cannot be read or is not a completion report', async () => {
  vi.mocked(axiomClient.readArtifact).mockRejectedValueOnce(
    new AxiomRpcError('artifact_corrupt', 'Stored bytes differ')
  )
  const answer = artifact()
  vi.mocked(axiomClient.readArtifact)
    .mockResolvedValueOnce({
      ...answer,
      meta: { ...answer.meta, kind: 'evidence', sha256: '9'.repeat(64) }
    })
    .mockResolvedValueOnce(artifact('not JSON'))
    .mockResolvedValueOnce(artifact('{"version":2}'))
    .mockResolvedValueOnce({
      ...answer,
      meta: { ...answer.meta, mediaType: 'text/plain', sha256: '9'.repeat(64) }
    })
    .mockResolvedValueOnce({ ...answer, contentBase64: btoa(String.fromCharCode(255)) })
  render(<MissionFinalization finalization={ready} />)
  for (let index = 0; index < 6; index += 1) {
    fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
    expect(await screen.findByText(readFailed)).toBeTruthy()
    if (index === 0) {
      expect(screen.getByText('artifact_corrupt: Stored bytes differ')).toBeTruthy()
    } else {
      expect(screen.queryByText('artifact_corrupt: Stored bytes differ')).toBeNull()
    }
    expect(
      screen.queryByText('The stored report is not the one this finalization recorded.')
    ).toBeNull()
    expect(screen.queryByRole('region', { name: 'Completion report' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Hide report' }))
  }
})

it('keeps an open report through a re-render with the same record and closes it when the record names another artifact', async () => {
  const { rerender } = render(<MissionFinalization finalization={ready} />)
  fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
  await screen.findByRole('region', { name: 'Completion report' })
  rerender(<MissionFinalization finalization={{ ...ready, gate: [...ready.gate] }} />)
  expect(screen.queryByRole('region', { name: 'Completion report' })).not.toBeNull()
  expect(axiomClient.readArtifact).toHaveBeenCalledTimes(1)
  rerender(<MissionFinalization finalization={{ ...ready, reportArtifactId: 'report-2' }} />)
  expect(screen.queryByRole('region', { name: 'Completion report' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Show report' })).toBeTruthy()
})

it('says when a ready record has no report', () => {
  const { reportArtifactId: _id, reportSha256: _sha, ...legacy } = ready
  render(<MissionFinalization finalization={{ ...legacy, gate: legacy.gate.slice(0, 7) }} />)
  expect(screen.getByText('This finalization recorded no completion report.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Show report' })).toBeNull()
  expect(
    within(screen.getByRole('table', { name: 'Completion gate' })).getAllByRole('row')
  ).toHaveLength(8)
})

it('drops answers after hiding or replacing a report', async () => {
  const { rerender } = render(<MissionFinalization finalization={ready} />)
  for (const replace of [false, true]) {
    let finish: ((value: ReturnType<typeof artifact>) => void) | undefined
    vi.mocked(axiomClient.readArtifact).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      })
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
    if (replace) {
      rerender(<MissionFinalization finalization={{ ...ready, reportArtifactId: 'report-new' }} />)
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'Hide report' }))
    }
    await act(async () => {
      finish?.(artifact())
    })
    expect(screen.queryByRole('region', { name: 'Completion report' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Show report' })).toBeTruthy()
  }
})
