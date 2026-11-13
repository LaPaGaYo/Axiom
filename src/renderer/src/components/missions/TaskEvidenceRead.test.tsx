// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { VerificationRunView } from '../../../../shared/axiom-contract/verification-params'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import type * as AxiomClientModule from '@/lib/axiom-client'
import { axiomClient } from '@/lib/axiom-client'
import { useAppStore } from '@/store'
import { toast } from 'sonner'
import {
  attempt,
  message,
  mission,
  missionUsage,
  verificationRun
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { useMissionsPageController } from './use-missions-page-controller'
import { TaskDetail } from './TaskDetail'

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
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
vi.mock('@/lib/axiom-client', async (importOriginal) => {
  const actual = await importOriginal<typeof AxiomClientModule>()
  return {
    ...actual,
    axiomClient: {
      ...actual.axiomClient,
      listMissions: vi.fn(),
      showMission: vi.fn(),
      listTasks: vi.fn(),
      listPlans: vi.fn(),
      listAttempts: vi.fn(),
      listMessages: vi.fn(),
      listVerificationRuns: vi.fn(),
      missionUsage: vi.fn()
    }
  }
})
const task = {
  id: attempt.taskId,
  missionId: mission.id,
  planRevisionId: 'plan-1',
  title: 'Task evidence',
  stage: 'VERIFYING' as const,
  orcaStatus: 'completed' as const
}
let controller: ReturnType<typeof useMissionsPageController>
function Harness() {
  controller = useMissionsPageController()
  return controller.taskDetail ? (
    <TaskDetail
      task={task}
      {...controller.taskDetail}
      busy={false}
      onAnswer={vi.fn()}
      onResolve={vi.fn()}
      onOpenWorktree={vi.fn()}
    />
  ) : null
}
const confirm = async () => true
function mount() {
  return render(
    <ConfirmationDialogContext.Provider value={confirm}>
      <Harness />
    </ConfirmationDialogContext.Provider>
  )
}
beforeEach(() => {
  vi.clearAllMocks()
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: task.id,
    missionRequests: {},
    missionError: null
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [task] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [attempt] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({
    messages: [{ ...message, pending: false }]
  })
  vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
})
afterEach(cleanup)

it('keeps the Task page when the verification or usage read fails', async () => {
  for (const failing of ['verification', 'usage'] as const) {
    vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
    vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
    if (failing === 'verification') {
      vi.mocked(axiomClient.listVerificationRuns).mockRejectedValue(new Error('offline'))
    } else {
      vi.mocked(axiomClient.missionUsage).mockRejectedValue(new Error('offline'))
    }
    const mounted = mount()
    await screen.findByRole('region', { name: 'Task detail' })
    expect(
      screen
        .getByRole('table', { name: 'Attempts' })
        .querySelectorAll<HTMLTableRowElement>('tbody tr')
    ).toHaveLength(1)
    expect(screen.getByRole('list', { name: 'Task messages' }).textContent).toContain(
      message.summary
    )
    expect(screen.getByRole('region', { name: 'Submission summary' })).toBeTruthy()
    expect(
      screen.getByText(
        failing === 'verification'
          ? 'Verification could not be read. Refresh to try again.'
          : 'Usage could not be read. Refresh to try again.'
      )
    ).toBeTruthy()
    expect(controller.taskDetail?.verificationError).toBe(failing === 'verification')
    expect(controller.taskDetail?.usageError).toBe(failing === 'usage')
    expect(controller.error).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [verificationRun] })
    vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
    await act(async () => controller.refresh())
    expect(controller.taskDetail?.verificationError).toBe(false)
    expect(controller.taskDetail?.usageError).toBe(false)
    expect(controller.taskDetail?.runs).toEqual([verificationRun])
    expect(controller.taskDetail?.usage).toEqual(missionUsage.tasks[0])
    mounted.unmount()
  }
})

it('discards late evidence when the selected Task changes', async () => {
  let finish: ((value: { runs: VerificationRunView[] }) => void) | undefined
  vi.mocked(axiomClient.listVerificationRuns).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  mount()
  await act(async () => controller.selectTask('other-task'))
  await screen.findByRole('region', { name: 'Task detail' })
  await act(async () => finish?.({ runs: [{ ...verificationRun, id: 'stale-run' }] }))
  expect(controller.taskDetail?.taskId).toBe('other-task')
  expect(controller.taskDetail?.runs).toEqual([verificationRun])
})
