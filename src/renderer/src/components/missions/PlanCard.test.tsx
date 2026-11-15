// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import {
  goal,
  mission,
  policy,
  provenance,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  GoalRevisionSchema,
  PlanRevisionSchema,
  type PlanRevision,
  type TaskSpec
} from '../../../../shared/axiom-contract/mission-objects'
import { MissionPendingResponseSchema } from '../../../../shared/axiom-contract/mission-pending'
import { PolicyResponseSchema } from '../../../../shared/axiom-contract/policy-params'
import { SupervisionShowResponse } from '../../../../shared/axiom-contract/supervision'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import type * as AxiomClientModule from '@/lib/axiom-client'
import { axiomClient, AxiomRpcError } from '@/lib/axiom-client'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { useMissionsPageController } from './use-missions-page-controller'
import { MissionsPageSurface } from './MissionsPageSurface'

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const { createMissionsSlice } = await import('@/store/slices/missions')
  return {
    useAppStore: create<MissionsSlice & { activeView: TopLevelView }>()((...a) => ({
      activeView: 'terminal',
      ...createMissionsSlice(...a)
    }))
  }
})
vi.mock('@/lib/sidebar-worktree-activation', () => ({ activateWorktreeFromSidebar: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/window-visibility-interval', () => ({ installWindowVisibilityInterval: vi.fn() }))
vi.mock('@/lib/axiom-client', async (importOriginal) => {
  const actual = await importOriginal<typeof AxiomClientModule>()
  return {
    ...actual,
    axiomClient: {
      ...actual.axiomClient,
      listMissions: vi.fn(),
      showMission: vi.fn(),
      showGoal: vi.fn(),
      listTasks: vi.fn(),
      listPlans: vi.fn(),
      listAttempts: vi.fn(),
      listMessages: vi.fn(),
      showTask: vi.fn(),
      listVerificationRuns: vi.fn(),
      missionUsage: vi.fn(),
      missionPending: vi.fn(),
      showSupervision: vi.fn(),
      showPolicy: vi.fn(),
      approvePlan: vi.fn(),
      rejectPlan: vi.fn()
    }
  }
})

const firstTask: TaskSpec = {
  ...taskWithSpec.spec,
  id: 'T01',
  title: 'Sprint validation',
  requiredEvidence: []
}
const currentGoal = GoalRevisionSchema.parse({
  ...goal,
  id: 'goal-1',
  missionId: mission.id,
  revision: 1,
  status: 'ACTIVE',
  acceptanceCriteria: ['First Goal criterion', 'Second Goal criterion', 'Third Goal criterion']
})
function plan(overrides: Partial<PlanRevision> = {}) {
  return PlanRevisionSchema.parse({
    id: 'plan-1',
    missionId: mission.id,
    revision: 1,
    status: 'PROPOSED',
    goalRevisionId: currentGoal.id,
    tasks: [firstTask],
    edges: [],
    milestones: [],
    risks: [],
    warnings: [],
    provenance,
    ...overrides
  })
}
const pendingPlan = {
  id: 'pending-plan',
  kind: 'plan_review',
  objectId: 'plan-1',
  reason: 'plan_review',
  blocking: true,
  blocks: 1,
  actions: ['axiom.plan.approve', 'axiom.plan.reject'],
  since: provenance.at
}
function pending(items: unknown[] = [pendingPlan]) {
  return MissionPendingResponseSchema.parse({ missionId: mission.id, items })
}
function policyView(verificationRules: Record<string, unknown> = {}) {
  return PolicyResponseSchema.parse({ policy: { ...policy, verificationRules } })
}
const warnings = PlanRevisionSchema.parse({
  ...plan(),
  warnings: [
    {
      code: 'incomplete_coverage',
      message: 'Uncovered Goal: #2',
      taskIds: [],
      uncovered: [{ index: 2, text: 'Third Goal criterion' }]
    },
    {
      code: 'scope_overlap',
      message: 'These scopes overlap.',
      taskIds: ['T01', 'T02'],
      paths: [{ a: 'src/**', b: 'src/sprint.ts' }]
    },
    {
      code: 'insufficient_parallel_roots',
      message: 'More roots were expected.',
      taskIds: ['T01', 'T02'],
      expected: 3,
      found: 2
    }
  ]
}).warnings
const confirm = vi.fn<ConfirmationDialogContextValue>()
function Harness() {
  return <MissionsPageSurface controller={useMissionsPageController()} />
}
async function mount() {
  await act(async () => {
    render(
      <TooltipProvider>
        <ConfirmationDialogContext.Provider value={confirm}>
          <Harness />
        </ConfirmationDialogContext.Provider>
      </TooltipProvider>
    )
  })
}
async function click(name: string, root: HTMLElement = document.body) {
  await act(async () => {
    fireEvent.click(within(root).getByRole('button', { name }))
  })
}
function card() {
  return screen.getByRole('region', { name: 'Plan review' })
}
function fact(root: HTMLElement, label: string) {
  const term = within(root).getByText(label, { exact: true })
  expect(term.tagName).toBe('DT')
  return term.nextElementSibling?.textContent
}
function commands(root: HTMLElement) {
  return within(within(root).getByRole('list', { name: 'Verification will run' }))
    .getAllByRole('listitem')
    .map((item) => ({
      command: item.querySelector('code')?.textContent,
      source: within(item).getByText(/^(setup|evidence|gate)$/).textContent
    }))
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
beforeEach(() => {
  vi.resetAllMocks()
  confirm.mockResolvedValue(true)
  vi.mocked(installWindowVisibilityInterval).mockImplementation(({ run }) => {
    run()
    return vi.fn()
  })
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: null,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({
    mission: { ...mission, status: 'PLAN_REVIEW', activeGoalRevisionId: currentGoal.id }
  })
  vi.mocked(axiomClient.showGoal).mockResolvedValue({ goalRevision: currentGoal })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [plan()] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending())
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(policyView())
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(
    SupervisionShowResponse.parse({
      rules: [
        {
          rule: 'stalled',
          globalMode: 'observe',
          globalSource: 'built_in',
          missionMode: null,
          effectiveMode: 'observe'
        }
      ],
      notifications: [],
      proposals: [],
      evidence: []
    })
  )
  vi.mocked(axiomClient.approvePlan).mockResolvedValue({
    planRevision: plan({ status: 'APPROVED' })
  })
  vi.mocked(axiomClient.rejectPlan).mockResolvedValue({
    planRevision: plan({ status: 'REJECTED' })
  })
})
afterEach(cleanup)

it('lists the commands verification will run for each Task under the Mission policy', async () => {
  const task: TaskSpec = {
    ...firstTask,
    risk: 'low',
    acceptanceCriteria: [
      { text: 'Unit suite', check: { kind: 'command', command: 'pnpm test' } },
      { text: 'Types', check: { kind: 'command', command: '  pnpm tc  ' } },
      { text: 'Inspect', check: { kind: 'human' } }
    ],
    requiredEvidence: ['pnpm test', 'pnpm legacy']
  }
  vi.mocked(axiomClient.listPlans).mockResolvedValue({
    planRevisions: [
      plan({
        tasks: [
          task,
          {
            ...firstTask,
            id: 'T02',
            title: 'Documentation',
            risk: 'medium',
            acceptanceCriteria: ['Read it']
          }
        ]
      })
    ]
  })
  const rules = {
    setupCommands: ['pnpm setup', 'pnpm prepare'],
    repositoryGates: { low: ['pnpm test', 'pnpm lint'], high: ['pnpm security'] }
  }
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(policyView(rules))
  await mount()
  const row = within(card()).getByRole('listitem', { name: 'T01 · Sprint validation' })
  expect(commands(row)).toEqual([
    { command: 'pnpm setup', source: 'setup' },
    { command: 'pnpm prepare', source: 'setup' },
    { command: 'pnpm test', source: 'evidence' },
    { command: 'pnpm tc', source: 'evidence' },
    { command: 'pnpm legacy', source: 'evidence' },
    { command: 'pnpm lint', source: 'gate' }
  ])
  expect(axiomClient.showPolicy).toHaveBeenCalledExactlyOnceWith({ missionId: mission.id })
  expect(
    within(card()).getAllByText(/These commands follow the Mission.s policy as it is now/)
  ).toHaveLength(1)
  expect(card().textContent).not.toContain('pnpm security')
  expect(card().querySelector('code')?.textContent).toBe('pnpm test')
  expect(within(row).getByText('  pnpm tc  ', { normalizer: (text) => text }).tagName).toBe('CODE')
  const read = deferred<Awaited<ReturnType<typeof axiomClient.showMission>>>()
  vi.mocked(axiomClient.showMission).mockReturnValueOnce(read.promise)
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(
    policyView({ ...rules, repositoryGates: { low: ['pnpm changed'] } })
  )
  const tick = vi.mocked(installWindowVisibilityInterval).mock.calls[0][0].run
  await act(async () => tick())
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(2)
  expect(commands(row).at(-1)?.command).toBe('pnpm lint')
  await act(async () => read.resolve({ mission: { ...mission, status: 'PLAN_REVIEW' } }))
  expect(commands(row).at(-1)).toEqual({ command: 'pnpm changed', source: 'gate' })
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(policyView())
  await click('Refresh Missions')
  expect(
    within(within(card()).getByRole('listitem', { name: 'T02 · Documentation' })).getByText(
      'No command will run for this Task.'
    )
  ).toBeTruthy()
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  await click('Refresh Missions')
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(4)
  expect(
    vi.mocked(axiomClient.showPolicy).mock.calls.every(([args]) => args.missionId === mission.id)
  ).toBe(true)
})

it('says so when the policy cannot be read or its verification rules are not valid', async () => {
  const proposed = plan({ tasks: [firstTask, { ...firstTask, id: 'T02', title: 'Other' }] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [proposed] })
  vi.mocked(axiomClient.showPolicy).mockRejectedValueOnce(new AxiomRpcError('refused', 'No policy'))
  await mount()
  expect(
    within(card()).getAllByText(
      "The Mission's policy could not be read, so the commands verification will run are not listed. Refresh to try again."
    )
  ).toHaveLength(2)
  const unavailable = () => {
    expect(within(card()).queryByRole('list', { name: 'Verification will run' })).toBeNull()
    for (const task of proposed.tasks) {
      const row = within(card()).getByRole('listitem', { name: `${task.id} · ${task.title}` })
      expect(row.querySelector('code')?.textContent).toBe('pnpm test')
    }
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen
        .getByRole('region', { name: 'Mission Home' })
        .querySelector('[data-mission-status]')
        ?.getAttribute('data-mission-status')
    ).toBe('PLAN_REVIEW')
    expect(screen.getByRole('table', { name: 'Tasks' })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  }
  unavailable()
  for (const failure of [new Error('transport failed'), new TypeError('call itself threw')]) {
    if (failure instanceof TypeError) {
      vi.mocked(axiomClient.showPolicy).mockImplementationOnce(() => {
        throw failure
      })
    } else {
      vi.mocked(axiomClient.showPolicy).mockRejectedValueOnce(failure)
    }
    await click('Refresh Missions')
    expect(within(card()).getAllByText(/policy could not be read/)).toHaveLength(2)
    unavailable()
  }
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(policyView({ unknownKey: true }))
  await click('Refresh Missions')
  expect(within(card()).getAllByText(/verification rules are not valid/)).toHaveLength(2)
  expect(card().textContent).toContain('INCONCLUSIVE (policy_invalid)')
  expect(card().textContent).toContain('without running a command')
  unavailable()
})

it('shows the scope and limits of each Task and how every criterion is proven', async () => {
  vi.mocked(axiomClient.listPlans).mockResolvedValue({
    planRevisions: [
      plan({
        milestones: [{ id: 'm1', title: 'First milestone', exitCriteria: [] }],
        tasks: [
          {
            ...firstTask,
            scope: { allowedPaths: ['src/sprint.ts', 'tests/sprint.ts'] },
            risk: 'high',
            retryPolicy: { maxAttempts: 3 },
            budget: {
              maxTokens: 5000,
              maxRuntimeMinutes: 20,
              maxWallClockMinutes: 25,
              maxCostUsd: 2,
              contextTokens: 1000
            },
            milestoneId: 'm1',
            role: 'implementer',
            acceptanceCriteria: [
              { text: 'Tests pass', check: { kind: 'command', command: '  pnpm test  ' } },
              { text: 'Report is readable', check: { kind: 'artifact', artifactKind: 'evidence' } },
              { text: 'Visual judgment', check: { kind: 'human' } },
              'Legacy criterion'
            ]
          },
          {
            ...firstTask,
            id: 'T02',
            title: 'Unbounded',
            scope: { allowedPaths: [] },
            budget: undefined,
            acceptanceCriteria: []
          }
        ]
      })
    ]
  })
  await mount()
  const row = within(card()).getByRole('listitem', { name: 'T01 · Sprint validation' })
  expect(fact(row, 'Allowed paths')).toBe('src/sprint.tstests/sprint.ts')
  for (const path of ['src/sprint.ts', 'tests/sprint.ts']) {
    expect(within(row).getByText(path).className).toContain('font-mono')
  }
  for (const [label, value] of [
    ['Risk level', 'high'],
    ['Attempt limit', '3'],
    ['Token limit', '5000'],
    ['maxRuntimeMinutes', '20'],
    ['maxWallClockMinutes', '25'],
    ['maxCostUsd', '2'],
    ['contextTokens', '1000'],
    ['Milestone', 'm1 · First milestone'],
    ['Role', 'implementer']
  ]) {
    expect(fact(row, label)).toBe(value)
  }
  const criteria = within(row).getByRole('list', { name: 'Acceptance criteria' })
  const proofs = within(criteria).getAllByRole('listitem')
  expect(proofs).toHaveLength(4)
  expect(proofs[0].textContent).toContain('Tests pass')
  expect(proofs[0].textContent).toContain('Proof: command')
  expect(proofs[0].querySelector('code')?.textContent).toBe('  pnpm test  ')
  expect(proofs[0].querySelector('code')?.className).toContain('whitespace-pre-wrap')
  expect(proofs[0].textContent).toContain(
    'Verification runs this command from the repository root on the candidate and requires exit 0.'
  )
  expect(proofs[1].textContent).toContain('artifact')
  expect(proofs[1].textContent).toContain('evidence')
  expect(proofs[1].textContent).toContain(
    'The submission must reference a readable, non-empty Artifact of the declared kind, when given.'
  )
  for (const proof of proofs.slice(2)) {
    expect(proof.textContent).toContain('human')
    expect(proof.textContent).toContain('A person confirms this criterion.')
  }
  expect(within(card()).getAllByText('Human check', { exact: true })).toHaveLength(2)
  const unbounded = within(card()).getByRole('listitem', { name: 'T02 · Unbounded' })
  expect(fact(unbounded, 'Allowed paths')).toBe('None')
  expect(fact(unbounded, 'Token limit')).toBe('No limit')
})

it('shows the milestones, the warnings and the Goal coverage of a plan', async () => {
  const proposed = plan({
    warnings,
    milestones: [
      { id: 'm1', title: 'First milestone', exitCriteria: ['First exit'] },
      { id: 'm2', title: 'Second milestone', exitCriteria: ['Second exit'] }
    ],
    tasks: [
      { ...firstTask, coversGoalCriteria: [0, 1] },
      { ...firstTask, id: 'T02', title: 'Other', coversGoalCriteria: [0] }
    ]
  })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [proposed] })
  await mount()
  const milestones = within(card()).getByRole('group', { name: 'Milestones' })
  for (const text of [
    'm1 · First milestone',
    'm2 · Second milestone',
    'First exit',
    'Second exit'
  ]) {
    expect(milestones.textContent).toContain(text)
  }
  expect(within(card()).getAllByRole('heading', { level: 2 })).toHaveLength(1)
  const warningGroup = within(card()).getByRole('group', { name: 'Warnings' })
  for (const warning of warnings) {
    expect(within(warningGroup).getByText(warning.code).className).toContain('font-mono')
    expect(within(warningGroup).getByText(warning.message)).toBeTruthy()
  }
  for (const text of [
    '#2',
    'Third Goal criterion',
    'T01',
    'T02',
    'src/**',
    'src/sprint.ts',
    'Expected: 3',
    'Found: 2'
  ]) {
    expect(warningGroup.textContent).toContain(text)
  }
  const coverage = within(card()).getByRole('group', { name: 'Goal coverage' })
  const rows = within(coverage).getAllByRole('listitem')
  expect(rows.map((row) => row.textContent)).toEqual([
    '#0 · First Goal criterionT01, T02',
    '#1 · Second Goal criterionT01',
    '#2 · Third Goal criterionNo Task covers it'
  ])
  for (const block of [milestones, warningGroup, coverage]) {
    expect(within(block).getByRole('heading', { level: 3 })).toBeTruthy()
  }
  vi.mocked(axiomClient.showGoal).mockResolvedValue({
    goalRevision: { ...currentGoal, id: 'another-goal' }
  })
  await click('Refresh Missions')
  expect(within(card()).queryByRole('group', { name: 'Goal coverage' })).toBeNull()
  vi.mocked(axiomClient.showMission).mockResolvedValue({
    mission: { ...mission, status: 'PLAN_REVIEW' }
  })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [plan()] })
  await click('Refresh Missions')
  for (const name of ['Goal coverage', 'Milestones', 'Warnings']) {
    expect(within(card()).queryByRole('group', { name })).toBeNull()
  }
})

it('shows the earlier rejection and what changed since it', async () => {
  const stable = {
    ...firstTask,
    id: 'stable',
    title: 'Stable Task',
    scope: { allowedPaths: ['a', 'b'] },
    acceptanceCriteria: ['Same text']
  }
  const previous = plan({
    id: 'plan-2',
    revision: 2,
    status: 'REJECTED',
    rejectedReason: 'Keep the scope narrow.',
    tasks: [
      {
        ...firstTask,
        scope: { allowedPaths: ['keep', 'old'] },
        risk: 'low',
        retryPolicy: { maxAttempts: 1 },
        coversGoalCriteria: [0],
        budget: { maxTokens: 100 }
      },
      { ...firstTask, id: 'removed', title: 'Removed Task' },
      stable,
      {
        ...firstTask,
        id: 'reordered',
        title: 'Reordered Task',
        scope: { allowedPaths: ['a', 'b'] }
      }
    ],
    edges: [
      { fromTaskId: 'T01', toTaskId: 'removed', readinessThreshold: 'INTEGRATED' },
      { fromTaskId: 'T01', toTaskId: 'stable', readinessThreshold: 'VERIFIED' }
    ]
  })
  const proposed = plan({
    id: 'plan-3',
    revision: 3,
    tasks: [
      {
        ...previous.tasks[0],
        title: 'Revised sprint',
        objective: 'New objective',
        role: 'reviewer',
        risk: 'medium',
        retryPolicy: { maxAttempts: 3 },
        scope: { allowedPaths: ['keep', 'new'] },
        budget: { maxTokens: 200 },
        coversGoalCriteria: [1],
        milestoneId: 'm1',
        kind: 'fix',
        acceptanceCriteria: [
          ...firstTask.acceptanceCriteria,
          { text: 'Extra coverage', check: { kind: 'command', command: 'pnpm extra' } }
        ]
      },
      { ...firstTask, id: 'added', title: 'Added Task' },
      { ...stable, acceptanceCriteria: [{ text: 'Same text', check: { kind: 'human' } }] },
      { ...previous.tasks[3], scope: { allowedPaths: ['b', 'a'] } }
    ],
    edges: [
      { fromTaskId: 'T01', toTaskId: 'added', readinessThreshold: 'INTEGRATED' },
      { fromTaskId: 'T01', toTaskId: 'stable', readinessThreshold: 'INTEGRATED' }
    ],
    milestones: [{ id: 'm1', title: 'New milestone', exitCriteria: [] }],
    risks: [{ id: 'r1', description: 'New risk' }]
  })
  const older = plan({ status: 'REJECTED', rejectedReason: 'Older reason.' })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [older, previous, proposed] })
  await mount()
  const changes = within(card()).getByRole('group', { name: 'Changes since revision 2' })
  expect(within(changes).getByText('Rejected because')).toBeTruthy()
  expect(changes.textContent).toContain(previous.rejectedReason)
  expect(card().textContent).not.toContain('Older reason.')
  expect(changes.textContent).toContain(
    'Tasks are matched by id, so a Task whose id changed shows as removed and added.'
  )
  expect(within(changes).getByRole('group', { name: 'Added Tasks' }).textContent).toContain(
    'added · Added Task'
  )
  expect(within(changes).getByRole('group', { name: 'Removed Tasks' }).textContent).toContain(
    'removed · Removed Task'
  )
  const changed = within(changes).getByRole('group', { name: 'Changed Tasks' })
  expect(within(changed).getByText('T01 · Revised sprint')).toBeTruthy()
  for (const text of [
    'Risk level',
    'low → medium',
    'Attempt limit',
    '1 → 3',
    'Allowed paths',
    'Removed: old',
    'Added: new',
    'Acceptance criteria',
    'Extra coverage',
    'command',
    'pnpm extra',
    'Title',
    'Objective',
    'Role',
    'Milestone',
    'Kind',
    'Goal criteria covered',
    'Declared budget limits',
    'maxTokens: 100',
    'maxTokens: 200'
  ]) {
    expect(changed.textContent).toContain(text)
  }
  expect(changed.textContent).not.toContain('Stable Task')
  expect(changed.textContent).not.toContain('Reordered Task')
  for (const text of [
    'Removed: T01 → removed · INTEGRATED',
    'Added: T01 → added · INTEGRATED',
    'Removed: T01 → stable · VERIFIED',
    'Added: T01 → stable · INTEGRATED',
    'Milestones changed.',
    'Risks changed.'
  ]) {
    expect(changes.textContent).toContain(text)
  }
  vi.mocked(axiomClient.listPlans).mockResolvedValue({
    planRevisions: [
      previous,
      { ...previous, id: proposed.id, revision: 3, status: 'PROPOSED', rejectedReason: undefined }
    ]
  })
  await click('Refresh Missions')
  expect(within(card()).getByText('No difference from revision 2.')).toBeTruthy()
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [proposed] })
  await click('Refresh Missions')
  expect(within(card()).queryByRole('group', { name: /Changes since revision/ })).toBeNull()
})

it('asks before a plan is approved and says what approval does', async () => {
  vi.mocked(axiomClient.listPlans).mockResolvedValue({
    planRevisions: [
      plan({ warnings: warnings.slice(0, 2), tasks: [firstTask, { ...firstTask, id: 'T02' }] })
    ]
  })
  const decision = deferred<boolean>()
  confirm.mockReturnValueOnce(decision.promise)
  await mount()
  await click('Approve plan', card())
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Approve plan',
      confirmLabel: 'Approve plan',
      confirmVariant: 'default',
      cancelLabel: 'Keep reviewing'
    })
  )
  const description = confirm.mock.calls.at(-1)?.[0].description ?? ''
  for (const text of [
    '2 Task(s)',
    'Nothing runs until the Mission is started.',
    'cannot be replaced by another one yet',
    'single Tasks can be changed',
    'where the Control Plane offers it',
    'Mission canceled',
    '2 warning(s)'
  ]) {
    expect(description).toContain(text)
  }
  expect(axiomClient.approvePlan).not.toHaveBeenCalled()
  await act(async () => decision.resolve(false))
  expect(axiomClient.approvePlan).not.toHaveBeenCalled()
  expect(within(card()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Plan revision 1 · PROPOSED'
  )
  await click('Approve plan', card())
  expect(axiomClient.approvePlan).toHaveBeenCalledExactlyOnceWith(
    { planRevisionId: 'plan-1', resolver: 'desktop-user' },
    expect.any(String)
  )
  vi.mocked(axiomClient.approvePlan).mockRejectedValueOnce(
    new AxiomRpcError('replan_not_supported', 'An approved plan cannot be replaced.')
  )
  await click('Approve plan', card())
  expect(screen.getByRole('alert').textContent).toBe(
    'replan_not_supported: An approved plan cannot be replaced.'
  )
  fireEvent.change(within(card()).getByRole('textbox', { name: 'Reason for rejection' }), {
    target: { value: 'Missing recovery evidence' }
  })
  await click('Reject plan', card())
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Reject plan',
      confirmLabel: 'Reject plan',
      confirmVariant: 'destructive'
    })
  )
  expect(axiomClient.rejectPlan).toHaveBeenCalledExactlyOnceWith(
    { planRevisionId: 'plan-1', resolver: 'desktop-user', reason: 'Missing recovery evidence' },
    expect.any(String)
  )
})

it('offers approval and rejection only while the pending view lists them', async () => {
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending([]))
  await mount()
  expect(within(card()).queryByRole('button', { name: 'Approve plan' })).toBeNull()
  const absent = () => {
    expect(within(card()).queryByRole('button', { name: 'Approve plan' })).toBeNull()
    expect(within(card()).queryByRole('button', { name: 'Reject plan' })).toBeNull()
    expect(within(card()).queryByRole('textbox', { name: 'Reason for rejection' })).toBeNull()
  }
  for (const items of [
    [],
    [{ ...pendingPlan, objectId: 'another-plan' }],
    [{ ...pendingPlan, actions: [] }]
  ]) {
    vi.mocked(axiomClient.missionPending).mockResolvedValue(pending(items))
    await click('Refresh Missions')
    absent()
    expect(
      within(card()).getByText('This plan cannot be approved or rejected right now.')
    ).toBeTruthy()
  }
  vi.mocked(axiomClient.missionPending).mockResolvedValue(
    pending([{ ...pendingPlan, actions: ['axiom.plan.approve'] }])
  )
  await click('Refresh Missions')
  expect(within(card()).getByRole('button', { name: 'Approve plan' })).toBeTruthy()
  expect(within(card()).queryByRole('button', { name: 'Reject plan' })).toBeNull()
  expect(within(card()).queryByRole('textbox')).toBeNull()
  vi.mocked(axiomClient.missionPending).mockRejectedValueOnce(new Error('offline'))
  await click('Refresh Missions')
  absent()
  expect(
    within(card()).getByText(
      'What can be done with this plan could not be read. Refresh to try again.'
    )
  ).toBeTruthy()
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending())
  vi.mocked(axiomClient.showMission).mockResolvedValue({
    mission: { ...mission, status: 'PAUSED' }
  })
  await click('Refresh Missions')
  expect(
    within(card()).getByRole<HTMLInputElement>('textbox', { name: 'Reason for rejection' }).disabled
  ).toBe(false)
  fireEvent.change(within(card()).getByRole('textbox'), { target: { value: 'Try again' } })
  for (const name of ['Approve plan', 'Reject plan']) {
    expect(within(card()).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false)
  }
  const held = deferred<Awaited<ReturnType<typeof axiomClient.showPolicy>>>()
  vi.mocked(axiomClient.showPolicy).mockReturnValueOnce(held.promise)
  await click('Refresh Missions')
  for (const name of ['Approve plan', 'Reject plan']) {
    expect(within(card()).getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(true)
  }
  await act(async () => held.resolve(policyView()))
})

it('keeps a rejected plan and its reason on the page', async () => {
  const rejected = plan({ status: 'REJECTED', rejectedReason: 'Explain the recovery tests.' })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [rejected] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({
    mission: { ...mission, status: 'ANALYZING' }
  })
  await mount()
  expect(within(card()).getByRole('heading', { level: 2 }).textContent).toBe(
    'Plan revision 1 · REJECTED'
  )
  expect(within(card()).getByText('Rejected because')).toBeTruthy()
  expect(within(card()).getByText('Explain the recovery tests.')).toBeTruthy()
  for (const name of ['Approve plan', 'Reject plan']) {
    expect(within(card()).queryByRole('button', { name })).toBeNull()
  }
  expect(within(card()).queryByRole('list', { name: 'Verification will run' })).toBeNull()
  for (const status of ['PROPOSED', 'APPROVED'] as const) {
    vi.mocked(axiomClient.listPlans).mockResolvedValue({
      planRevisions: [rejected, plan({ id: 'plan-2', revision: 2, status })]
    })
    vi.mocked(axiomClient.showMission).mockResolvedValue({
      mission: { ...mission, activePlanRevisionId: status === 'APPROVED' ? 'plan-2' : null }
    })
    await click('Refresh Missions')
    expect(screen.getAllByRole('region', { name: 'Plan review' })).toHaveLength(1)
    expect(within(card()).getByRole('heading', { level: 2 }).textContent).toBe(
      `Plan revision 2 · ${status}`
    )
    if (status === 'APPROVED') {
      expect(within(card()).queryByRole('list', { name: 'Verification will run' })).toBeNull()
    }
  }
})
