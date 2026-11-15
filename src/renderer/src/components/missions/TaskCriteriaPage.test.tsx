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
  taskWithSpec,
  reviewPendingItem,
  verificationRun,
  missionUsage
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  GoalRevisionSchema,
  PlanRevisionSchema,
  type PlanRevision
} from '../../../../shared/axiom-contract/mission-objects'
import { MissionPendingResponseSchema } from '../../../../shared/axiom-contract/mission-pending'
import { PolicyResponseSchema } from '../../../../shared/axiom-contract/policy-params'
import { SupervisionShowResponse } from '../../../../shared/axiom-contract/supervision'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
import {
  evidenceCommandMessage,
  validateAcceptanceCommands
} from '../../../../shared/axiom-contract/evidence-commands'
import {
  ConfirmationDialogContext,
  type ConfirmationDialogContextValue
} from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import type * as AxiomClientModule from '@/lib/axiom-client'
import { axiomClient } from '@/lib/axiom-client'
import { AxiomRpcError } from '@/lib/axiom-rpc-call'
import { installWindowVisibilityInterval } from '@/lib/window-visibility-interval'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import { useMissionsPageController } from './use-missions-page-controller'
import { MissionsPageSurface } from './MissionsPageSurface'
import { PlanReviewPanel } from './PlanReviewPanel'

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
      readArtifact: vi.fn(),
      adjustTask: vi.fn()
    }
  }
})
afterEach(cleanup)
const currentGoal = GoalRevisionSchema.parse({
  ...goal,
  id: 'goal-1',
  missionId: mission.id,
  revision: 1,
  status: 'ACTIVE',
  acceptanceCriteria: []
})
const approved = PlanRevisionSchema.parse({
  id: 'plan-1',
  missionId: mission.id,
  revision: 1,
  status: 'APPROVED',
  goalRevisionId: currentGoal.id,
  tasks: [taskWithSpec.spec],
  edges: [],
  milestones: [],
  risks: [],
  provenance
})
const note =
  "Tasks can be adjusted after a plan is approved. A Task's own page shows its acceptance criteria as they are now."
const confirm = vi.fn<ConfirmationDialogContextValue>()
const rules = VerificationRulesSchema.parse({ evidenceCommands: { allowedPrograms: ['node'] } })
const task = {
  ...taskWithSpec,
  spec: {
    ...taskWithSpec.spec,
    requiredEvidence: [],
    acceptanceCriteria: [
      { text: 'Stored check', check: { kind: 'command' as const, command: 'node check.js' } }
    ]
  }
}
function Harness() {
  return <MissionsPageSurface controller={useMissionsPageController()} />
}
async function click(name: string) {
  await act(async () => fireEvent.click(screen.getByRole('button', { name })))
}
function fill(name: string, value: string) {
  fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } })
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
    selectedTaskId: task.id,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({
    mission: {
      ...mission,
      status: 'EXECUTING',
      activeGoalRevisionId: currentGoal.id,
      activePlanRevisionId: approved.id
    }
  })
  vi.mocked(axiomClient.showGoal).mockResolvedValue({ goalRevision: currentGoal })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [task] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [approved] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({ messages: [] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task })
  vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
  vi.mocked(axiomClient.missionPending).mockResolvedValue(
    MissionPendingResponseSchema.parse({
      missionId: mission.id,
      items: [{ ...reviewPendingItem, actions: ['axiom.task.adjust'] }]
    })
  )
  vi.mocked(axiomClient.showPolicy).mockResolvedValue(
    PolicyResponseSchema.parse({ policy: { ...policy, verificationRules: rules } })
  )
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
})

it('shows the reasons of the Control Plane when it refuses an adjustment', async () => {
  const messages = ['First reason.', 'Second reason.']
  vi.mocked(axiomClient.adjustTask).mockRejectedValue(
    new AxiomRpcError('plan_invalid', 'plan_invalid', {
      errors: [{ message: messages[0] }, { message: messages[1] }, { message: messages[0] }]
    })
  )
  await act(async () => {
    render(
      <TooltipProvider>
        <ConfirmationDialogContext.Provider value={confirm}>
          <Harness />
        </ConfirmationDialogContext.Provider>
      </TooltipProvider>
    )
  })
  await click('Adjust Task')
  fill('Rationale', 'Correct the plan')
  await click('Apply adjustment')
  expect(screen.getByRole('alert').textContent).toBe('plan_invalid: First reason. Second reason.')
  expect(toast.error).toHaveBeenLastCalledWith('plan_invalid: First reason. Second reason.')
  fireEvent.click(screen.getByRole('checkbox', { name: 'Replace acceptance criteria' }))
  fill('Text of criterion 1', 'Edited check')
  fill('Command of criterion 1', 'git status')
  const issue = validateAcceptanceCommands(
    [{ text: 'Edited check', check: { kind: 'command', command: 'git status' } }],
    rules
  )[0]
  const commandField = screen.getByRole('textbox', { name: 'Command of criterion 1' })
  expect(document.getElementById(commandField.getAttribute('aria-describedby')!)?.textContent).toBe(
    evidenceCommandMessage(issue, issue.command)
  )
  expect(screen.getByRole('button', { name: 'Apply adjustment' }).hasAttribute('disabled')).toBe(
    true
  )
  expect(axiomClient.adjustTask).toHaveBeenCalledTimes(1)
  fill('Command of criterion 1', 'node corrected.js')
  await click('Apply adjustment')
  expect(screen.getByRole('alert').textContent).toBe('plan_invalid: First reason. Second reason.')
  expect(screen.getByRole('form', { name: 'Adjust Task' })).toBeTruthy()
  expect(screen.getByRole('textbox', { name: 'Text of criterion 1' })).toHaveProperty(
    'value',
    'Edited check'
  )
  expect(commandField).toHaveProperty('value', 'node corrected.js')
  vi.mocked(axiomClient.adjustTask).mockRejectedValue(
    new AxiomRpcError('illegal_transition', 'illegal_transition', { reason: 'task_not_adjustable' })
  )
  await click('Apply adjustment')
  expect(screen.getByRole('alert').textContent).toBe('illegal_transition: task_not_adjustable')
  vi.mocked(axiomClient.adjustTask).mockRejectedValue(
    new AxiomRpcError('retry_budget_exhausted', 'The Attempts are used up.', {
      errors: [{ message: 'Ignored detail' }],
      reason: 'Ignored reason'
    })
  )
  await click('Apply adjustment')
  expect(screen.getByRole('alert').textContent).toBe(
    'retry_budget_exhausted: The Attempts are used up.'
  )
  vi.mocked(axiomClient.showPolicy).mockRejectedValue(new Error('Policy unavailable'))
  await act(async () => {
    await vi.mocked(installWindowVisibilityInterval).mock.calls.at(-1)?.[0].run()
  })
  expect(
    screen.getByText(
      "The Mission's policy could not be read, so the commands are not checked here. The Control Plane checks them when the adjustment is applied."
    )
  ).toBeTruthy()
  fill('Command of criterion 1', 'git status')
  expect(screen.queryByText(evidenceCommandMessage(issue, issue.command))).toBeNull()
  expect(screen.getByRole('button', { name: 'Apply adjustment' }).hasAttribute('disabled')).toBe(
    false
  )
})

it('leaves the Goal coverage out when the Goal lists no criteria', () => {
  const p = {
    plan: approved,
    goal: currentGoal,
    busy: false,
    onApprove: vi.fn(),
    onReject: vi.fn()
  }
  const { rerender } = render(<PlanReviewPanel {...p} />)
  expect(screen.getByText(note)).toBeTruthy()
  expect(screen.queryByRole('group', { name: 'Goal coverage' })).toBeNull()
  rerender(
    <PlanReviewPanel {...p} goal={{ ...currentGoal, acceptanceCriteria: ['Goal to cover'] }} />
  )
  expect(
    within(screen.getByRole('group', { name: 'Goal coverage' })).getByText('#0 · Goal to cover')
  ).toBeTruthy()
})

it('says on an approved plan that its Tasks may have been adjusted', () => {
  const p = { plan: approved, busy: false, onApprove: vi.fn(), onReject: vi.fn() }
  const { rerender } = render(<PlanReviewPanel {...p} />)
  expect(within(screen.getByRole('region', { name: 'Plan review' })).getByText(note)).toBeTruthy()
  const statuses: PlanRevision['status'][] = ['PROPOSED', 'REJECTED']
  for (const status of statuses) {
    rerender(<PlanReviewPanel {...p} plan={{ ...approved, status }} />)
    expect(screen.queryByText(note)).toBeNull()
  }
})
