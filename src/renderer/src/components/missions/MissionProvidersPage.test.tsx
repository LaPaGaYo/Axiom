// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { mission, policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
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

vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children
  }: {
    value: string
    onValueChange: (value: string) => void
    disabled: boolean
    children: ReactNode
  }) => (
    <select
      value={value}
      disabled={disabled}
      onChange={(event) => onValueChange(event.currentTarget.value)}
    >
      {children}
    </select>
  ),
  SelectTrigger: () => null,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: ReactNode }) => (
    <option value={value}>{children}</option>
  )
}))
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

const stored = PolicySchema.parse({
  ...policy,
  routing: { disallowedProviders: ['codex', 'claude'] }
})
const yes = { eligible: true }
const providers = (['codex', 'claude'] as const).map((provider) => ({
  provider,
  planner: yes,
  worker: { low: yes, medium: yes, high: yes }
}))
const confirm = vi.fn<ConfirmationDialogContextValue>()
const applies =
  'A Planner started after this change and Worker Attempts admitted after it use the new choice. Attempts that are already running keep their provider.'
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
async function press(element: HTMLElement) {
  await act(async () => {
    fireEvent.click(element)
  })
}
function region() {
  return screen.getByRole('region', { name: 'Providers' })
}
function pendingRow() {
  return within(screen.getByRole('list', { name: 'Pending items' })).getByRole('listitem')
}
function form() {
  return screen.getByRole('form', { name: 'Edit the providers of this Mission' })
}
function availabilityCalls() {
  return vi
    .mocked(axiomClient.showPolicy)
    .mock.calls.filter(([params]) => params.providers === true)
}
function changeWorker(value: string) {
  fireEvent.change(screen.getAllByRole('combobox')[1], { target: { value } })
}
async function refresh() {
  const run = vi.mocked(installWindowVisibilityInterval).mock.calls.at(-1)?.[0].run
  if (!run) {
    throw new Error('Missing quiet refresh')
  }
  await act(async () => {
    run()
  })
}
function heldRead() {
  let answer: (response: Awaited<ReturnType<typeof axiomClient.showPolicy>>) => void = () => {
    throw new Error('No read pending')
  }
  const promise = new Promise<Awaited<ReturnType<typeof axiomClient.showPolicy>>>((resolve) => {
    answer = resolve
  })
  return { promise, answer }
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
  vi.mocked(axiomClient.missionPending).mockResolvedValue({
    missionId: mission.id,
    items: [
      {
        id: 'waiting',
        kind: 'task_blocked',
        objectId: 'task-1',
        taskId: 'task-1',
        reason: 'no_eligible_provider',
        blocking: true,
        blocks: 0,
        actions: ['axiom.policy.update', 'axiom.task.cancel'],
        since: '2026-11-24T12:00:00Z'
      }
    ]
  })
  vi.mocked(axiomClient.showSupervision).mockResolvedValue({
    rules: [],
    notifications: [],
    evidence: [],
    proposals: []
  })
  vi.mocked(axiomClient.showPolicy).mockImplementation(async (params) =>
    params.providers ? { policy: stored, providers } : { policy: stored }
  )
  vi.mocked(axiomClient.updatePolicy).mockResolvedValue({ policy: stored })
})
afterEach(cleanup)

it('reads provider availability once when the provider form opens', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  expect(availabilityCalls()).toHaveLength(0)
  expect(screen.queryByRole('table', { name: 'Provider availability' })).toBeNull()
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  expect(availabilityCalls()).toEqual([[{ missionId: mission.id, providers: true }]])
  changeWorker('claude')
  const newer = PolicySchema.parse({
    ...stored,
    routing: {
      ...stored.routing,
      roles: { planner: { provider: 'codex' } },
      requireCertified: true
    }
  })
  vi.mocked(axiomClient.showPolicy).mockResolvedValue({ policy: newer })
  await refresh()
  expect(availabilityCalls()).toHaveLength(1)
  expect(screen.getByRole('table', { name: 'Provider availability' })).toBeTruthy()
  expect(screen.getAllByRole<HTMLSelectElement>('combobox').map((select) => select.value)).toEqual([
    'automatic',
    'claude'
  ])
  vi.mocked(axiomClient.showPolicy).mockRejectedValueOnce(new Error('read failed'))
  await refresh()
  expect(form()).toBeTruthy()
  expect(
    within(form()).getByText("The Mission's policy could not be read. Refresh to try again.")
  ).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save providers' }).disabled).toBe(
    true
  )
  await refresh()
  await press(screen.getByRole('button', { name: 'Save providers' }))
  expect(axiomClient.updatePolicy).toHaveBeenCalledExactlyOnceWith(
    {
      missionId: mission.id,
      patch: {
        routing: {
          ...newer.routing,
          roles: { ...newer.routing.roles, worker: { provider: 'claude' } }
        }
      }
    },
    expect.any(String)
  )
})

it('opens the provider form from the pending item and moves focus to it', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  await press(within(pendingRow()).getByRole('button', { name: 'Edit providers' }))
  expect(document.activeElement).toBe(form())
  expect(form().tabIndex).toBe(-1)
  expect(availabilityCalls()).toEqual([[{ missionId: mission.id, providers: true }]])
  await press(screen.getByRole('button', { name: 'Close' }))
  vi.mocked(axiomClient.showPolicy).mockRejectedValue(new Error('read failed'))
  await refresh()
  expect(within(pendingRow()).queryByRole('button', { name: 'Edit providers' })).toBeNull()
  expect(within(region()).queryByRole('button', { name: 'Edit providers' })).toBeNull()
})

it('asks before it saves providers and writes nothing when the person keeps editing', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  changeWorker('claude')
  await press(screen.getByRole('checkbox', { name: 'Only certified combinations' }))
  let answer: (confirmed: boolean) => void = () => {
    throw new Error('No confirmation pending')
  }
  confirm.mockReturnValueOnce(
    new Promise<boolean>((resolve) => {
      answer = resolve
    })
  )
  await press(screen.getByRole('button', { name: 'Save providers' }))
  expect(confirm).toHaveBeenCalledExactlyOnceWith({
    title: 'Save policy',
    confirmLabel: 'Save policy',
    cancelLabel: 'Keep editing',
    confirmVariant: 'default',
    cancelVariant: 'ghost',
    description: `This changes: Workers, Only certified combinations. ${applies}`
  })
  expect(axiomClient.updatePolicy).not.toHaveBeenCalled()
  for (const select of within(form()).getAllByRole<HTMLSelectElement>('combobox')) {
    expect(select.disabled).toBe(true)
  }
  for (const checkbox of within(form()).getAllByRole<HTMLButtonElement>('checkbox')) {
    expect(checkbox.disabled).toBe(true)
  }
  for (const button of within(form()).getAllByRole<HTMLButtonElement>('button')) {
    expect(button.disabled).toBe(true)
  }
  await act(async () => {
    answer(false)
  })
  expect(axiomClient.updatePolicy).not.toHaveBeenCalled()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  expect(screen.getAllByRole<HTMLSelectElement>('combobox')[1].value).toBe('claude')
  expect(
    screen
      .getByRole('checkbox', { name: 'Only certified combinations' })
      .getAttribute('aria-checked')
  ).toBe('true')
})

it('saves the allowed providers through the client once and shows the routing the page then reads', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  await press(screen.getByRole('checkbox', { name: 'Codex' }))
  const next = PolicySchema.parse({
    ...stored,
    routing: {
      ...stored.routing,
      disallowedProviders: ['claude'],
      roles: { worker: { provider: 'codex' } }
    }
  })
  vi.mocked(axiomClient.updatePolicy).mockImplementationOnce(async () => {
    vi.mocked(axiomClient.showPolicy).mockResolvedValue({ policy: next })
    return { policy: stored }
  })
  await press(screen.getByRole('button', { name: 'Save providers' }))
  expect(axiomClient.updatePolicy).toHaveBeenCalledExactlyOnceWith(
    PolicyUpdateParams.parse({
      missionId: mission.id,
      patch: { routing: { ...stored.routing, disallowedProviders: ['claude'] } }
    }),
    expect.any(String)
  )
  expect(confirm).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ description: `This changes: Allowed providers. ${applies}` })
  )
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(3)
  expect(screen.queryByRole('form', { name: 'Edit the providers of this Mission' })).toBeNull()
  expect(within(region()).getByRole('button', { name: 'Edit providers' })).toBeTruthy()
  expect(region().querySelector('[data-providers-value="disallowed"]')?.textContent).toBe('Claude')
  expect(region().querySelector('[data-providers-value="worker"]')?.textContent).toBe('Codex')
})

it('keeps the provider draft when the Control Plane refuses', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  changeWorker('claude')
  vi.mocked(axiomClient.updatePolicy).mockRejectedValueOnce(
    new AxiomRpcError('refused', 'Policy refused')
  )
  await press(screen.getByRole('button', { name: 'Save providers' }))
  expect(confirm).toHaveBeenCalledTimes(1)
  expect(axiomClient.updatePolicy).toHaveBeenCalledTimes(1)
  expect(axiomClient.showPolicy).toHaveBeenCalledTimes(3)
  expect(screen.getByRole('alert').textContent).toBe('refused: Policy refused')
  expect(toast.error).toHaveBeenCalledWith('refused: Policy refused')
  expect(form()).toBeTruthy()
  expect(screen.getAllByRole<HTMLSelectElement>('combobox')[1].value).toBe('claude')
})

it('drops an availability answer that arrives after the form was closed', async () => {
  await mount()
  expect(screen.queryByRole('region', { name: 'Providers' })).not.toBeNull()
  const first = heldRead()
  const second = heldRead()
  const third = heldRead()
  const fourth = heldRead()
  vi.mocked(axiomClient.showPolicy)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise)
    .mockReturnValueOnce(third.promise)
    .mockReturnValueOnce(fourth.promise)
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  expect(screen.getByText('Reading which providers can be used…').getAttribute('role')).toBe(
    'status'
  )
  await press(screen.getByRole('button', { name: 'Close' }))
  await press(within(region()).getByRole('button', { name: 'Edit providers' }))
  await act(async () => {
    first.answer({ policy: stored, providers })
  })
  expect(screen.queryByRole('table', { name: 'Provider availability' })).toBeNull()
  expect(screen.getByText('Reading which providers can be used…')).toBeTruthy()
  await act(async () => {
    second.answer({ policy: stored, providers })
  })
  expect(screen.getByRole('table', { name: 'Provider availability' })).toBeTruthy()
  changeWorker('claude')
  const openForm = form()
  const entry = within(pendingRow()).getByRole('button', { name: 'Edit providers' })
  entry.focus()
  await press(entry)
  expect(form()).toBe(openForm)
  expect(document.activeElement).toBe(entry)
  expect(screen.getAllByRole<HTMLSelectElement>('combobox')[1].value).toBe('claude')
  expect(screen.getByText('Reading which providers can be used…')).toBeTruthy()
  await press(entry)
  await act(async () => {
    third.answer({ policy: stored, providers })
  })
  expect(screen.queryByRole('table', { name: 'Provider availability' })).toBeNull()
  await act(async () => {
    fourth.answer({ policy: stored, providers })
  })
  expect(screen.getByRole('table', { name: 'Provider availability' })).toBeTruthy()
  expect(availabilityCalls()).toHaveLength(4)
  expect(screen.getAllByRole<HTMLSelectElement>('combobox')[1].value).toBe('claude')
})
