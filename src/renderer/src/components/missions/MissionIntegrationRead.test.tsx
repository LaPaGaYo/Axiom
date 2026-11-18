// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { axiomClient } from '@/lib/axiom-client'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import {
  attempt,
  mission,
  missionUsage,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import type { TaskIntegration } from '../../../../shared/axiom-contract/integration-batch'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
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
vi.mock('@/lib/axiom-client', () => ({
  axiomClient: {
    listMissions: vi.fn(),
    showMission: vi.fn(),
    listTasks: vi.fn(),
    showTask: vi.fn(),
    listPlans: vi.fn(),
    listAttempts: vi.fn(),
    listMessages: vi.fn(),
    listVerificationRuns: vi.fn(),
    missionUsage: vi.fn(),
    missionPending: vi.fn()
  }
}))
const integration: TaskIntegration = {
  batchId: 'batch-page',
  candidateId: verificationRun.candidateId,
  status: 'PROMOTED',
  baseCommit: '1'.repeat(40),
  mergeCommit: '2'.repeat(40),
  conflicts: [],
  updatedAt: '2026-11-18T12:05:00Z'
}
const missionIntegration = {
  branch: `axiom/integration/${mission.id}`,
  recordedHead: '2'.repeat(40)
}
const task = { ...taskWithSpec, stage: 'INTEGRATED' as const, integration }
const candidateRun: VerificationRunView = {
  ...verificationRun,
  status: 'PASS',
  verdictDetail: { phase: 'verdict', verdict: 'PASS', reason: 'checks_passed', checks: [] }
}
const regressionRun: VerificationRunView = {
  ...candidateRun,
  id: 'regression-page',
  batchId: integration.batchId,
  verifier: 'IntegrationController'
}
let controller: ReturnType<typeof useMissionsPageController>
const confirm = async () => true
function Harness() {
  controller = useMissionsPageController()
  return <MissionsPageSurface controller={controller} />
}
function mount() {
  return render(
    <TooltipProvider>
      <ConfirmationDialogContext.Provider value={confirm}>
        <Harness />
      </ConfirmationDialogContext.Provider>
    </TooltipProvider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: task.id,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission, integration: missionIntegration })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [task] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [attempt] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({ messages: [] })
  vi.mocked(axiomClient.listVerificationRuns).mockImplementation(async (params) => ({
    runs: params.batchId ? [regressionRun] : [candidateRun]
  }))
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
  vi.mocked(axiomClient.missionPending).mockResolvedValue({ missionId: mission.id, items: [] })
})
afterEach(cleanup)

it('the page shows the Integration block and the regression of the selected Task', async () => {
  mount()
  const detail = await screen.findByRole('region', { name: 'Task detail' })
  const block = screen.getByRole('region', { name: 'Integration' })
  expect(within(block).getByText(missionIntegration.branch)).toBeTruthy()
  expect(within(block).getByTestId('integration-recorded-head').textContent).toBe('2222222')
  const regression = within(detail).getByRole('region', {
    name: 'Merged-tree regression'
  })
  expect(within(regression).getByText(regressionRun.id)).toBeTruthy()
})

it('reads the regression runs by the batch the Task carries', async () => {
  mount()
  await screen.findByRole('region', { name: 'Task detail' })
  expect(axiomClient.listVerificationRuns).toHaveBeenCalledWith({
    missionId: mission.id,
    taskId: task.id
  })
  expect(axiomClient.listVerificationRuns).toHaveBeenCalledWith({
    missionId: mission.id,
    batchId: integration.batchId
  })
})

it('makes no regression request when the Task has no batch', async () => {
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task: taskWithSpec })
  mount()
  await screen.findByRole('region', { name: 'Task detail' })
  expect(
    vi.mocked(axiomClient.listVerificationRuns).mock.calls.some(([params]) => 'batchId' in params)
  ).toBe(false)
  expect(controller.taskDetail).not.toHaveProperty('regressionRuns')
  expect(controller.taskDetail).not.toHaveProperty('regressionError')
})

it('keeps the Task page when the regression read fails', async () => {
  vi.mocked(axiomClient.listVerificationRuns).mockImplementation(async (params) => {
    if (params.batchId) {
      throw new Error('offline')
    }
    return { runs: [candidateRun] }
  })
  mount()
  const detail = await screen.findByRole('region', { name: 'Task detail' })
  expect(within(detail).getByRole('table', { name: 'Verification runs' }).textContent).toContain(
    candidateRun.id
  )
  expect(within(detail).getByRole('table', { name: 'Attempts' }).textContent).toContain(
    attempt.branch
  )
  const regression = within(detail).getByRole('region', {
    name: 'Merged-tree regression'
  })
  expect(
    within(regression).getByText('Regression runs could not be read. Refresh to try again.')
  ).toBeTruthy()
  expect(controller.taskDetail).toHaveProperty('regressionError', true)
  expect(controller.taskDetail).toHaveProperty('regressionRuns', [])
  expect(controller.error).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  vi.mocked(axiomClient.listVerificationRuns).mockImplementation(async (params) => ({
    runs: params.batchId ? [regressionRun] : [candidateRun]
  }))
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Missions' }))
  await waitFor(() => expect(controller.busy).toBe(false))
  expect(within(regression).getByText(regressionRun.id)).toBeTruthy()
  expect(controller.taskDetail).toHaveProperty('regressionError', false)
  expect(
    within(regression).queryByText('Regression runs could not be read. Refresh to try again.')
  ).toBeNull()
})

it('an older main process shows the page as before', async () => {
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task: taskWithSpec })
  mount()
  const detail = await screen.findByRole('region', { name: 'Task detail' })
  expect(within(detail).getByRole('table', { name: 'Verification runs' })).toBeTruthy()
  expect(screen.queryByRole('region', { name: 'Integration' })).toBeNull()
  expect(screen.queryByRole('region', { name: 'Merged-tree regression' })).toBeNull()
})

it('the Integrated indicator opens the record that holds the regression', async () => {
  mount()
  const detail = await screen.findByRole('region', { name: 'Task detail' })
  const indicator = within(detail)
    .getAllByRole('button')
    .find((button) => button.dataset.taskStage === 'INTEGRATED')
  if (!indicator) {
    throw new Error('Missing Integrated indicator')
  }
  fireEvent.click(indicator)
  const record = within(detail).getByRole('region', { name: 'Verification' })
  expect(document.activeElement).toBe(record)
  expect(within(record).getByRole('region', { name: 'Merged-tree regression' })).toBeTruthy()
})
