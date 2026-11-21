// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import {
  CompletionReportSchema,
  completionReportText
} from '../../../../shared/axiom-contract/completion-report'
import { FINALIZATION_GATE_IDS } from '../../../../shared/axiom-contract/mission-finalization'
import { MissionReport } from './MissionReport'

const untrusted = '<img src=x onerror=alert(1)> [link](https://example.invalid) **bold**'
const first = {
  taskId: 'task-first',
  planTaskId: 'T01',
  planRevisionId: 'plan-2',
  title: 'First integrated Task',
  kind: 'task',
  stage: 'INTEGRATED',
  attempts: [
    {
      seq: 2,
      branch: 'attempt/first/2',
      agentSpecId: 'spec',
      contextPackageId: 'context',
      provider: 'codex',
      model: 'model',
      effort: 'high',
      channel: 'tui',
      posture: 'tui-bypass',
      candidateId: 'candidate-first'
    }
  ],
  runs: [{ id: 'run-first', candidateId: 'candidate-first', status: 'PASS' }],
  openQuestions: [
    { source: 'message', id: 'question', text: 'Is the remaining limit acceptable?' },
    { source: 'gate', id: 'gate-question', text: 'Confirm later' }
  ],
  candidate: { id: 'candidate-first', commitSha: '1'.repeat(40), treeSha: '2'.repeat(40) },
  summary: untrusted,
  limitations: ['Only local data'],
  risks: ['A stored Worker risk'],
  followUps: ['Review the next release'],
  verification: {
    runId: 'run-first',
    status: 'PASS',
    verifier: 'Verifier',
    toolVersions: { node: '24' },
    checks: [
      { command: 'check one', result: 'pass', criteria: [0] },
      { command: 'check two', result: 'pass', criteria: [0] },
      { command: 'check three', result: 'skipped', criteria: [] }
    ],
    artifacts: [{ id: 'verdict', sha256: '3'.repeat(64) }]
  },
  integration: {
    batchId: 'batch-first',
    baseCommit: '4'.repeat(40),
    mergeCommit: '5'.repeat(40),
    regressionRunId: 'regression-first',
    regressionStatus: 'PASS'
  }
}
const second = {
  ...first,
  taskId: 'task-second',
  planTaskId: 'T04',
  title: 'Second integrated Task',
  candidate: { id: 'candidate-second', commitSha: '6'.repeat(40), treeSha: '7'.repeat(40) },
  attempts: [],
  runs: [],
  openQuestions: [],
  summary: '',
  limitations: [],
  risks: [],
  followUps: [],
  verification: {
    ...first.verification,
    runId: 'run-second',
    resolution: { verdict: 'PASS', rationale: 'Reviewed by a person', at: '2026-11-20T12:00:00Z' }
  },
  integration: { ...first.integration, batchId: 'batch-second', mergeCommit: '8'.repeat(40) }
}
const canceled = {
  taskId: 'task-canceled',
  planTaskId: 'T05',
  planRevisionId: 'plan-2',
  title: 'Canceled Task',
  kind: 'task',
  stage: 'CANCELED',
  cancelRationale: 'Superseded by the revised scope',
  attempts: [],
  runs: [],
  openQuestions: []
}
const report = CompletionReportSchema.parse({
  version: 1,
  mission: { id: 'mission-report', repoId: 'repo', targetBranch: 'main' },
  goal: {
    id: 'goal',
    revision: 1,
    objective: 'Ship the reviewed work',
    constraints: ['Keep the data offline'],
    criteria: [
      { index: 0, text: 'Both changes are integrated', coveredBy: [first.taskId, second.taskId] },
      { index: 1, text: 'Historical coverage', coveredBy: ['unlisted-task'] },
      { index: 2, text: 'No coverage', coveredBy: [] }
    ],
    revisions: [{ id: 'goal', revision: 1, status: 'ACTIVE' }]
  },
  plans: [
    {
      id: 'plan-2',
      revision: 2,
      status: 'APPROVED',
      goalRevisionId: 'goal',
      provenance: { kind: 'planner', actor: 'planner-actor', model: 'planner-model' },
      taskIds: ['T01', 'T04', 'T05'],
      risks: [
        {
          id: 'plan-risk',
          description: 'Plan risk description',
          mitigation: 'Run the offline checks'
        }
      ]
    }
  ],
  tasks: [first, second, canceled],
  decisions: ['decision-1', 'decision-2', 'decision-3'],
  gate: FINALIZATION_GATE_IDS.map((id) => ({ id, pass: true, evidence: [] })),
  commits: {
    integrationHead: 'a'.repeat(40),
    targetHead: 'b'.repeat(40),
    promoted: [first.integration.mergeCommit, second.integration.mergeCommit]
  },
  risks: [
    { kind: 'bypass_posture', taskId: first.taskId, seq: 2 },
    { kind: 'human_resolved_verification', taskId: second.taskId, runId: 'run-second' }
  ]
})
afterEach(cleanup)

it('shows the Goal and which Tasks cover each criterion', () => {
  render(<MissionReport report={report} />)
  expect(screen.getByText(report.goal.objective)).toBeTruthy()
  expect(screen.getByText(report.goal.constraints[0])).toBeTruthy()
  const rows = within(screen.getByRole('table', { name: 'Criteria and the Tasks that cover them' }))
    .getAllByRole('row')
    .slice(1)
  expect(rows).toHaveLength(3)
  expect(rows[0].textContent).toContain('#0')
  expect(rows[0].textContent).toContain(report.goal.criteria[0].text)
  expect(within(rows[0]).getByText(first.title)).toBeTruthy()
  expect(within(rows[0]).getByText(second.title)).toBeTruthy()
  expect(within(rows[1]).getByText('unlisted-task').className).toContain('font-mono')
  expect(within(rows[2]).getByText('—')).toBeTruthy()
})

it('lists every Task with its candidate, verification, regression and merge commit', () => {
  render(<MissionReport report={report} />)
  const rows = within(screen.getByRole('table', { name: 'Tasks in the report' }))
    .getAllByRole('row')
    .slice(1)
  expect(rows.map((row) => row.getAttribute('data-report-task-id'))).toEqual(
    report.tasks.map((task) => task.taskId)
  )
  for (const [index, task] of [first, second].entries()) {
    const row = within(rows[index])
    expect(row.getByText('Integrated')).toBeTruthy()
    expect(row.getByText('INTEGRATED')).toBeTruthy()
    expect(row.getByText(task.candidate.commitSha.slice(0, 7)).getAttribute('title')).toBe(
      task.candidate.commitSha
    )
    expect(row.getByText(task.integration.mergeCommit.slice(0, 7)).getAttribute('title')).toBe(
      task.integration.mergeCommit
    )
    expect(row.getByText('2 of 3 check(s) passed')).toBeTruthy()
    const cells = row.getAllByRole('cell')
    expect(cells[3].textContent).toContain('PASS')
    expect(cells[4].textContent).toBe('PASS')
  }
  expect(within(rows[1]).getByText('Resolved by a person: PASS')).toBeTruthy()
  expect(within(rows[2]).getByText(`Canceled: ${canceled.cancelRationale}`)).toBeTruthy()
  expect(
    within(rows[2])
      .getAllByRole('cell')
      .slice(2)
      .map((cell) => cell.textContent)
  ).toEqual(['—', '—', '—', '—'])
})

it('shows the summary, limitations, risks, follow-ups and open questions of a Task as plain text', () => {
  const { container } = render(<MissionReport report={report} />)
  expect(screen.getByText(untrusted)).toBeTruthy()
  for (const text of [
    ...first.limitations,
    ...first.risks,
    ...first.followUps,
    ...first.openQuestions.map((question) => question.text)
  ]) {
    expect(screen.getByText(text)).toBeTruthy()
  }
  expect(screen.getByText('message')).toBeTruthy()
  expect(screen.getByText('gate')).toBeTruthy()
  expect(container.querySelector('img, a, strong')).toBeNull()
  expect(screen.getByRole('heading', { name: first.title })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: second.title })).toBeNull()
  expect(screen.queryByRole('heading', { name: canceled.title })).toBeNull()
  for (const name of ['Limitations', 'Risks', 'Follow-ups', 'Open questions']) {
    expect(screen.queryByRole('list', { name })).toBeNull()
  }
})

it('lists the risks the Control Plane recorded and says so when there are none', () => {
  const { rerender } = render(<MissionReport report={report} />)
  const bypass = screen
    .getByText('An Attempt ran as a terminal agent, not in the headless sandbox')
    .closest('li')
  expect(bypass?.textContent).toContain(first.title)
  expect(bypass?.textContent).toContain('Attempt 2')
  const resolved = screen.getByText('A person resolved the verification of this Task').closest('li')
  expect(resolved?.textContent).toContain(second.title)
  expect(resolved?.textContent).toContain('run-second')
  rerender(<MissionReport report={{ ...report, risks: [] }} />)
  expect(screen.getByText('The Control Plane recorded no risk.')).toBeTruthy()
})

it('shows the plans with their risks and the commits', () => {
  render(<MissionReport report={report} />)
  for (const text of [
    'Plan revision 2',
    'APPROVED',
    'planner',
    'planner-actor',
    'planner-model',
    'Plan risk description',
    'Mitigation: Run the offline checks'
  ]) {
    expect(screen.getByText(text)).toBeTruthy()
  }
  for (const commit of [
    report.commits.integrationHead,
    report.commits.targetHead,
    ...report.commits.promoted
  ]) {
    for (const element of screen.getAllByText(commit.slice(0, 7))) {
      expect(element.getAttribute('title')).toBe(commit)
    }
  }
  expect(screen.getByText('3 decision(s) recorded')).toBeTruthy()
})

it('shows the raw JSON only when asked', () => {
  const { container } = render(<MissionReport report={report} />)
  expect(container.querySelector('pre')).toBeNull()
  const button = screen.getByRole('button', { name: 'Show raw JSON' })
  expect(button.getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(button)
  expect(container.querySelector('pre')?.textContent).toBe(completionReportText(report))
  expect(screen.getByRole('button', { name: 'Hide raw JSON' }).getAttribute('aria-expanded')).toBe(
    'true'
  )
  fireEvent.click(button)
  expect(container.querySelector('pre')).toBeNull()
})
