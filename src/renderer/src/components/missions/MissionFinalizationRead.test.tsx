// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import { TooltipProvider } from '@/components/ui/tooltip'
import { axiomClient } from '@/lib/axiom-client'
import { useAppStore } from '@/store'
import {
  attempt,
  evidenceArtifact,
  mission,
  missionUsage,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { CompletionReportSchema } from '../../../../shared/axiom-contract/completion-report'
import { FINALIZATION_GATE_IDS } from '../../../../shared/axiom-contract/mission-finalization'
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
    missionPending: vi.fn(),
    readArtifact: vi.fn()
  }
}))
const finalization = {
  outcome: 'ready' as const,
  at: '2026-11-20T12:00:00Z',
  targetBranch: 'main',
  targetHead: '1'.repeat(40),
  integrationHead: '2'.repeat(40),
  gate: FINALIZATION_GATE_IDS.map((id) => ({ id, pass: true, evidence: [] })),
  reportArtifactId: 'report-page',
  reportSha256: '3'.repeat(64)
}
const integration = {
  branch: `axiom/integration/${mission.id}`,
  recordedHead: finalization.integrationHead
}
const report = CompletionReportSchema.parse({
  version: 1,
  mission: { id: mission.id, repoId: mission.repoId, targetBranch: 'main' },
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
  gate: finalization.gate,
  commits: {
    integrationHead: finalization.integrationHead,
    targetHead: finalization.targetHead,
    promoted: []
  },
  risks: []
})
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
    selectedTaskId: null,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockImplementation(async () => ({
    mission,
    integration,
    finalization: { ...finalization }
  }))
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.showTask).mockResolvedValue({ task: taskWithSpec })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [attempt] })
  vi.mocked(axiomClient.listMessages).mockResolvedValue({ messages: [] })
  vi.mocked(axiomClient.listVerificationRuns).mockResolvedValue({ runs: [] })
  vi.mocked(axiomClient.missionUsage).mockResolvedValue(missionUsage)
  vi.mocked(axiomClient.missionPending).mockResolvedValue({ missionId: mission.id, items: [] })
  const bytes = new TextEncoder().encode(JSON.stringify(report))
  vi.mocked(axiomClient.readArtifact).mockResolvedValue({
    meta: {
      ...evidenceArtifact.meta,
      id: finalization.reportArtifactId,
      kind: 'completion_report',
      mediaType: 'application/json',
      sha256: finalization.reportSha256,
      sizeBytes: bytes.length
    },
    contentBase64: btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''))
  })
})
afterEach(cleanup)

it('the page shows the Finalization section of a Mission that has a record', async () => {
  mount()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Finalization' })).not.toBeNull())
  const section = screen.getByRole('region', { name: 'Finalization' })
  const before = screen.getByRole('region', { name: 'Integration' })
  const after = screen.getByRole('region', { name: 'Tasks' })
  expect(before.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(section.compareDocumentPosition(after) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(section.querySelector('[data-finalization-outcome="ready"]')).not.toBeNull()
  expect(within(section).getByTestId('completion-report-sha').getAttribute('title')).toBe(
    finalization.reportSha256
  )
})

it('the page reads the report only when asked and keeps it open through a refresh', async () => {
  mount()
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Finalization' })).not.toBeNull())
  expect(axiomClient.readArtifact).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Show report' }))
  await screen.findByRole('region', { name: 'Completion report' })
  expect(axiomClient.readArtifact).toHaveBeenCalledTimes(1)
  const previous = controller.detail
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Missions' }))
  await waitFor(() => {
    expect(controller.detail).not.toBe(previous)
    expect(controller.busy).toBe(false)
  })
  expect(screen.queryByRole('region', { name: 'Completion report' })).not.toBeNull()
  expect(axiomClient.readArtifact).toHaveBeenCalledTimes(1)
})

it('a Mission without a finalization record shows the page as before', async () => {
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission, integration })
  mount()
  await screen.findByRole('region', { name: 'Tasks' })
  expect(screen.queryByRole('region', { name: 'Finalization' })).toBeNull()
  expect(axiomClient.readArtifact).not.toHaveBeenCalled()
})
