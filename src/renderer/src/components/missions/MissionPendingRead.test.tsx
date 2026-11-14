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
let controller: ReturnType<typeof useMissionsPageController>
const task = {
  ...taskWithSpec,
  waitingOn: { on: 'human' as const, reason: 'acceptance_human', person: true }
}
const items = [reviewPendingItem, { ...reviewPendingItem, id: 'other', taskId: 'other-task' }]
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
    selectedTaskId: null,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [task] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task: taskWithSpec })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({ messages: [] })
  vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
  vi.mocked(axiomClient.missionPending).mockResolvedValue({ missionId: mission.id, items })
})
afterEach(cleanup)
async function refresh() {
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Missions' }))
  await waitFor(() => expect(controller.busy).toBe(false))
}

it('keeps Mission Home when the pending read fails', async () => {
  useAppStore.setState({ selectedTaskId: task.id })
  vi.mocked(axiomClient.missionPending).mockRejectedValue(new Error('offline'))
  mount()
  await screen.findByRole('region', { name: 'Task detail' })
  const home = screen.getByRole('region', { name: 'Mission Home' })
  expect(
    within(home).queryByText('Pending items could not be read. Refresh to try again.')
  ).not.toBeNull()
  expect(screen.getByRole('table', { name: 'Tasks' })).toBeTruthy()
  expect(within(home).queryByText(/pending item\(s\)/)).toBeNull()
  expect(within(home).queryByRole('list', { name: 'Pending items' })).toBeNull()
  expect(screen.getByText('Actions could not be read. Refresh to try again.')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(controller.error).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  vi.mocked(axiomClient.missionPending).mockResolvedValue({ missionId: mission.id, items })
  await refresh()
  expect(within(home).getByText('2 pending item(s)')).toBeTruthy()
  expect(screen.queryByText('Pending items could not be read. Refresh to try again.')).toBeNull()
  expect(screen.getByRole('region', { name: 'Task actions' })).toBeTruthy()
  expect(controller.taskDetail?.pendingError).toBe(false)
})

it('reads the pending view once for the Mission and its selected Task', async () => {
  mount()
  await screen.findByRole('region', { name: 'Mission Home' })
  expect(axiomClient.missionPending).toHaveBeenCalledExactlyOnceWith({ missionId: mission.id })
  const home = screen.getByRole('region', { name: 'Mission Home' })
  const list = () => within(home).getByRole('list', { name: 'Pending items' })
  expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
  expect(within(list()).getAllByRole('listitem')[1].textContent).toContain('other-task')
  await refresh()
  expect(axiomClient.missionPending).toHaveBeenCalledTimes(2)
  fireEvent.click(within(home).getByRole('button', { name: task.title }))
  await screen.findByRole('region', { name: 'Task detail' })
  expect(axiomClient.missionPending).toHaveBeenCalledTimes(3)
  expect(controller.taskDetail?.pendingItems).toEqual([reviewPendingItem])
  expect(within(list()).getAllByRole('listitem')).toHaveLength(2)
  expect(
    within(screen.getByRole('region', { name: 'Task actions' }))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Resolve review', 'Rerun verification', 'Adjust Task', 'Cancel Task'])
  await refresh()
  expect(axiomClient.missionPending).toHaveBeenCalledTimes(4)
  expect(controller.taskDetail?.pendingItems).toEqual([reviewPendingItem])
})
