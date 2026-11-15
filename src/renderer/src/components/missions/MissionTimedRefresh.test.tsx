// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import type { PlanRevision } from '../../../../shared/axiom-contract/mission-objects'
import {
  mission,
  provenance,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { axiomClient } from '@/lib/axiom-client'
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
vi.mock('@/lib/axiom-client', () => ({
  axiomClient: {
    listMissions: vi.fn(),
    showMission: vi.fn(),
    listTasks: vi.fn(),
    listPlans: vi.fn(),
    listAttempts: vi.fn(),
    missionPending: vi.fn()
  }
}))
const plan: PlanRevision = {
  id: 'plan-1',
  missionId: mission.id,
  goalRevisionId: 'goal-1',
  revision: 1,
  status: 'PROPOSED',
  tasks: [taskWithSpec.spec],
  edges: [],
  milestones: [],
  risks: [],
  warnings: [],
  provenance
}
const confirm = async () => true
function Harness() {
  return <MissionsPageSurface controller={useMissionsPageController()} />
}
beforeEach(() => {
  vi.clearAllMocks()
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
    mission: { ...mission, status: 'PLAN_REVIEW' }
  })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [plan] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.missionPending).mockResolvedValue({
    missionId: mission.id,
    items: [
      {
        id: 'pending-plan',
        kind: 'plan_review',
        objectId: plan.id,
        reason: 'plan_review',
        blocking: true,
        blocks: 1,
        actions: ['axiom.plan.approve', 'axiom.plan.reject'],
        since: provenance.at
      }
    ]
  })
})
afterEach(cleanup)

it('keeps typed text and focus through a timed tick', async () => {
  await act(async () => {
    render(
      <TooltipProvider>
        <ConfirmationDialogContext.Provider value={confirm}>
          <Harness />
        </ConfirmationDialogContext.Provider>
      </TooltipProvider>
    )
  })
  expect(installWindowVisibilityInterval).toHaveBeenCalledTimes(1)
  const tick = vi.mocked(installWindowVisibilityInterval).mock.calls[0][0].run
  const review = screen.getByRole('region', { name: 'Plan review' })
  const reason = within(review).getByLabelText<HTMLInputElement>('Reason for rejection')
  fireEvent.change(reason, { target: { value: 'Please cover the recovery path.' } })
  reason.focus()
  expect(document.activeElement).toBe(reason)
  let resolve!: (value: Awaited<ReturnType<typeof axiomClient.listMissions>>) => void
  vi.mocked(axiomClient.listMissions).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done
    })
  )
  await act(async () => tick())
  expect(axiomClient.listMissions).toHaveBeenCalledTimes(2)
  expect(reason.disabled).toBe(false)
  for (const name of ['Approve plan', 'Reject plan', 'Refresh Missions']) {
    expect(screen.getByRole<HTMLButtonElement>('button', { name }).disabled).toBe(false)
  }
  expect(document.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
  expect(screen.queryByRole('status')).toBeNull()
  expect(reason.value).toBe('Please cover the recovery path.')
  expect(document.activeElement).toBe(reason)
  await act(async () => resolve({ missions: [mission, { ...mission, id: 'mission-2' }] }))
  expect(
    within(screen.getByRole('navigation', { name: 'Mission list' })).getByText('mission-2')
  ).toBeTruthy()
  expect(reason.value).toBe('Please cover the recovery path.')
  expect(document.activeElement).toBe(reason)
  expect(toast.error).not.toHaveBeenCalled()
})
