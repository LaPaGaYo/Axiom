// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { axiomClient } from '@/lib/axiom-client'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import {
  attempt,
  message,
  mission,
  missionUsage,
  reviewPendingItem,
  taskWithSpec,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
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
afterEach(cleanup)
let controller: ReturnType<typeof useMissionsPageController>
const confirm = async () => true
function Harness() {
  controller = useMissionsPageController()
  return <MissionsPageSurface controller={controller} />
}
it('keeps the Task page when the Task read fails', async () => {
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: taskWithSpec.id,
    missionRequests: {},
    missionError: null
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.showTask).mockRejectedValue(new Error('offline'))
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [attempt] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({
    messages: [{ ...message, pending: false }]
  })
  vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
  vi.mocked(axiomClient.missionPending).mockResolvedValue({
    missionId: mission.id,
    items: [reviewPendingItem]
  })
  render(
    <TooltipProvider>
      <ConfirmationDialogContext.Provider value={confirm}>
        <Harness />
      </ConfirmationDialogContext.Provider>
    </TooltipProvider>
  )
  await screen.findByRole('region', { name: 'Task detail' })
  expect(screen.getByRole('table', { name: 'Attempts' }).querySelectorAll('tbody tr')).toHaveLength(
    1
  )
  expect(screen.getByRole('region', { name: 'Submission summary' })).toBeTruthy()
  expect(screen.getByRole('list', { name: 'Task messages' }).textContent).toContain(message.summary)
  expect(screen.getByRole('region', { name: 'Verification' })).toBeTruthy()
  const region = screen.getByRole('region', { name: 'Task actions' })
  expect(
    within(region)
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Resolve review', 'Rerun verification', 'Adjust Task', 'Cancel Task'])
  fireEvent.click(within(region).getByRole('button', { name: 'Adjust Task' }))
  expect(screen.getByText('The Task could not be read. Refresh to try again.')).toBeTruthy()
  expect(screen.queryByRole('form', { name: 'Adjust Task' })).toBeNull()
  expect(controller.error).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task: taskWithSpec })
  await act(async () => controller.refresh())
  expect(axiomClient.showTask).toHaveBeenLastCalledWith({ taskId: taskWithSpec.id })
  expect(controller.taskDetail?.taskSpec).toEqual(taskWithSpec.spec)
  expect(screen.getByRole('form', { name: 'Adjust Task' })).toBeTruthy()
  expect(screen.queryByText('The Task could not be read. Refresh to try again.')).toBeNull()
})
