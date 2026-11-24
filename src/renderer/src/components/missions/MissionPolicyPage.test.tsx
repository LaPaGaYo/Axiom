// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { mission, policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import { VerificationRulesSchema } from '../../../../shared/axiom-contract/verification-rules'
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
      listTasks: vi.fn(),
      listPlans: vi.fn(),
      listAttempts: vi.fn(),
      missionPending: vi.fn(),
      showSupervision: vi.fn(),
      showPolicy: vi.fn(),
      updatePolicy: vi.fn()
    }
  }
})

const stored = PolicySchema.parse(policy)
const confirm = vi.fn<ConfirmationDialogContextValue>()
const runsHere =
  'Setup commands and gates run on this computer when a Task is verified and when its merge is checked. A change applies to runs that start after it.'
function Harness() {
  const controller = useMissionsPageController()
  return <MissionsPageSurface controller={controller} />
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
async function click(name: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
function field(label: string) {
  return screen.getByRole<HTMLInputElement>('textbox', { name: label })
}
function change(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } })
}
function value(key: string) {
  return screen
    .getByRole('region', { name: 'Policy' })
    .querySelector(`[data-policy-value="${key}"]`)?.textContent
}
beforeEach(() => {
  vi.resetAllMocks()
  confirm.mockResolvedValue(true)
  vi.mocked(installWindowVisibilityInterval).mockImplementation(() => vi.fn())
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: null,
    missionRequests: {},
    missionError: null,
    missionCreateOpen: false
  })
  vi.mocked(axiomClient.listMissions).mockResolvedValue({ missions: [mission] })
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.missionPending).mockResolvedValue({ missionId: mission.id, items: [] })
  vi.mocked(axiomClient.showSupervision).mockResolvedValue({
    rules: [],
    notifications: [],
    evidence: [],
    proposals: []
  })
  vi.mocked(axiomClient.showPolicy).mockResolvedValue({ policy: stored })
  vi.mocked(axiomClient.updatePolicy).mockResolvedValue({ policy: stored })
})
afterEach(cleanup)

it('asks before it saves and writes nothing when the person keeps editing', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Policy' })).not.toBeNull()
  await click('Edit policy')
  change('Tasks at once', '5')
  change('Setup commands', 'node --version')
  let answer: (confirmed: boolean) => void = () => {
    throw new Error('No confirmation pending')
  }
  confirm.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      answer = resolve
    })
  )
  await click('Save policy')
  expect(confirm).toHaveBeenCalledExactlyOnceWith({
    title: 'Save policy',
    confirmLabel: 'Save policy',
    cancelLabel: 'Keep editing',
    confirmVariant: 'default',
    cancelVariant: 'ghost',
    description: `This changes: Tasks at once, Setup commands. ${runsHere}`
  })
  expect(axiomClient.updatePolicy).not.toHaveBeenCalled()
  const form = screen.getByRole('form', { name: 'Edit the policy of this Mission' })
  for (const control of within(form).getAllByRole<HTMLInputElement>('textbox')) {
    expect(control.disabled).toBe(true)
  }
  for (const control of within(form).getAllByRole<HTMLButtonElement>('button')) {
    expect(control.disabled).toBe(true)
  }
  await act(async () => {
    answer(false)
  })
  expect(axiomClient.updatePolicy).not.toHaveBeenCalled()
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('alert')).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  expect(field('Tasks at once').value).toBe('5')
  expect(field('Setup commands').value).toBe('node --version')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save policy' }).disabled).toBe(
    false
  )
})

it('saves through the client once and shows the policy the page then reads', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Policy' })).not.toBeNull()
  await click('Edit policy')
  change('Tasks at once', '4')
  change('Setup commands', ' node --version \n\n node --version \n')
  const next = PolicySchema.parse({
    ...stored,
    concurrencyLimit: 6,
    verificationRules: { setupCommands: ['pnpm --version'], timeBudgetMinutes: 50 }
  })
  vi.mocked(axiomClient.updatePolicy).mockImplementationOnce(async () => {
    vi.mocked(axiomClient.showPolicy).mockResolvedValue({ policy: next })
    return { policy: stored }
  })
  await click('Save policy')
  expect(axiomClient.updatePolicy).toHaveBeenCalledExactlyOnceWith(
    PolicyUpdateParams.parse({
      missionId: mission.id,
      patch: {
        concurrencyLimit: 4,
        verificationRules: { setupCommands: ['node --version', 'node --version'] }
      }
    }),
    expect.any(String)
  )
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(2)
  expect(screen.queryByRole('form', { name: 'Edit the policy of this Mission' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Edit policy' })).toBeTruthy()
  expect(value('concurrency')).toBe('6')
  expect(value('setup')).toBe('pnpm --version')
  expect(value('minutes')).toBe('50')
})

it('keeps the form and the draft when the Control Plane refuses', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Policy' })).not.toBeNull()
  await click('Edit policy')
  change('Tasks at once', '5')
  change('Setup commands', 'node --version')
  vi.mocked(axiomClient.updatePolicy).mockRejectedValueOnce(
    new AxiomRpcError('refused', 'Policy refused')
  )
  await click('Save policy')
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(axiomClient.updatePolicy).toHaveBeenCalledTimes(1)
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(2)
  expect(screen.getByRole('alert').textContent).toBe('refused: Policy refused')
  expect(toast.error).toHaveBeenCalledWith('refused: Policy refused')
  expect(screen.getByRole('form', { name: 'Edit the policy of this Mission' })).toBeTruthy()
  expect(field('Tasks at once').value).toBe('5')
  expect(field('Setup commands').value).toBe('node --version')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save policy' }).disabled).toBe(
    false
  )
})

it('keeps the draft when a refresh hands the page a new policy', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Policy' })).not.toBeNull()
  await click('Edit policy')
  change('Setup commands', 'node --version')
  const current = PolicySchema.parse({
    ...stored,
    concurrencyLimit: 8,
    verificationRules: VerificationRulesSchema.parse({
      repositoryGates: { high: [] },
      integrationGates: [],
      timeBudgetMinutes: 60,
      knownFlaky: ['new-case']
    })
  })
  vi.mocked(axiomClient.showPolicy).mockResolvedValue({ policy: current })
  const refresh = vi.mocked(installWindowVisibilityInterval).mock.calls.at(-1)?.[0].run
  expect(refresh).toBeDefined()
  if (!refresh) {
    throw new Error('Missing quiet refresh')
  }
  await act(async () => {
    refresh()
  })
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(2)
  expect(field('Setup commands').value).toBe('node --version')
  expect(field('Tasks at once').value).toBe('3')
  expect(field('Verification time budget (minutes)').value).toBe('30')
  await click('Save policy')
  expect(axiomClient.updatePolicy).toHaveBeenCalledExactlyOnceWith(
    {
      missionId: mission.id,
      patch: {
        verificationRules: { ...current.verificationRules, setupCommands: ['node --version'] }
      }
    },
    expect.any(String)
  )
  expect(confirm).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ description: `This changes: Setup commands. ${runsHere}` })
  )
})
