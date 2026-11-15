// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import {
  mission,
  taskWithSpec
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import { SupervisionShowResponse } from '../../../../shared/axiom-contract/supervision'
import { MissionPendingResponseSchema } from '../../../../shared/axiom-contract/mission-pending'
import { TERMINAL_MISSION_STATUSES } from '../../../../shared/axiom-contract/lifecycle'
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
      updateSupervision: vi.fn(),
      resolveSupervision: vi.fn()
    }
  }
})

type View = ReturnType<typeof SupervisionShowResponse.parse>
const initial = SupervisionShowResponse.parse({
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
  evidence: [],
  proposals: []
})
const proposal = {
  id: 'proposal-1',
  rule: 'stalled',
  fromMode: 'observe',
  toMode: 'notify',
  status: 'OPEN',
  evidence: {
    hits: 19,
    falsePositives: 1,
    known: 20,
    inconclusive: 3,
    hitRate: 0.95,
    savedMs: 5_400_000,
    sinceSequence: 0,
    throughSequence: 23
  },
  sinceSequence: 0,
  throughSequence: 23,
  resolver: null,
  createdAt: '2026-11-14 12:00:00',
  resolvedAt: null
}
const pendingProposal = {
  id: 'pending-proposal',
  kind: 'supervision_proposal',
  objectId: proposal.id,
  reason: 'stalled',
  blocking: false,
  blocks: 0,
  actions: ['axiom.supervision.resolve'],
  since: '2026-11-14T12:00:00Z'
}
function pending(items: unknown[] = []) {
  return MissionPendingResponseSchema.parse({ missionId: mission.id, items })
}
function view(rule: Partial<View['rules'][number]> = {}, proposals: unknown[] = []) {
  return SupervisionShowResponse.parse({
    ...initial,
    rules: [{ ...initial.rules[0], ...rule }],
    proposals
  })
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const confirm = vi.fn<ConfirmationDialogContextValue>()
let controller: ReturnType<typeof useMissionsPageController>
function Harness() {
  controller = useMissionsPageController()
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
async function click(name: string, root: HTMLElement = document.body) {
  await act(async () => {
    fireEvent.click(within(root).getByRole('button', { name }))
  })
}
async function choose(mode: string) {
  await act(async () => {
    fireEvent.click(screen.getByRole('radio', { name: mode }))
  })
}
function fact(region: HTMLElement, label: string) {
  const term = within(region).getByText(label, { exact: true })
  expect(term.tagName).toBe('DT')
  return term.nextElementSibling
}
function checked(mode: string) {
  expect(screen.getByRole('radio', { name: mode }).getAttribute('aria-checked')).toBe('true')
}
function saveEnabled(enabled: boolean) {
  expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Save stall mode' }).disabled).toBe(
    !enabled
  )
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
  vi.mocked(axiomClient.showMission).mockResolvedValue({ mission })
  vi.mocked(axiomClient.listTasks).mockResolvedValue({ tasks: [taskWithSpec] })
  vi.mocked(axiomClient.listPlans).mockResolvedValue({ planRevisions: [] })
  vi.mocked(axiomClient.listAttempts).mockResolvedValue({ attempts: [] })
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending())
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(initial)
  vi.mocked(axiomClient.updateSupervision).mockResolvedValue(initial)
  vi.mocked(axiomClient.resolveSupervision).mockResolvedValue(initial)
})
afterEach(cleanup)

it('shows the stall mode in effect for the Mission and where it comes from', async () => {
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  expect(axiomClient.showSupervision).toHaveBeenCalledExactlyOnceWith({ missionId: mission.id })
  expect(screen.getByRole('region', { name: 'Mission Home' }).contains(region)).toBe(false)
  expect(within(region).getByText('Stalled Workers')).toBeTruthy()
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('observe')
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('audit')
  expect(fact(region, "This Mission's setting")?.textContent).toBe('default')
  expect(fact(region, 'Default for all Missions')?.textContent).toContain('observe')
  expect(fact(region, 'Default for all Missions')?.textContent).toContain('built in')
  for (const mode of within(region).getAllByText('observe', { exact: true })) {
    expect(mode.className).toContain('font-mono')
  }
  expect(within(region).queryByRole('region', { name: 'Upgrade proposal' })).toBeNull()
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(
    view({
      missionMode: 'notify',
      effectiveMode: 'notify',
      globalMode: 'stop',
      globalSource: 'proposal'
    })
  )
  const missionRead = deferred<Awaited<ReturnType<typeof axiomClient.showMission>>>()
  vi.mocked(axiomClient.showMission).mockReturnValueOnce(missionRead.promise)
  await click('Refresh Missions')
  expect(axiomClient.showSupervision).toHaveBeenCalledTimes(2)
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('observe')
  await act(async () => missionRead.resolve({ mission }))
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('notify')
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('pending notice')
  expect(fact(region, "This Mission's setting")?.textContent).toBe('notify')
  expect(fact(region, 'Default for all Missions')?.textContent).toContain('stop')
  expect(fact(region, 'Default for all Missions')?.textContent).toContain(
    'from an accepted proposal'
  )
  expect(axiomClient.showSupervision).toHaveBeenCalledTimes(2)
  expect(axiomClient.showSupervision).toHaveBeenLastCalledWith({ missionId: mission.id })
  for (const failure of [
    new AxiomRpcError('mission_not_found', 'Not found'),
    new Error('offline'),
    new TypeError('call threw')
  ]) {
    if (failure instanceof TypeError) {
      vi.mocked(axiomClient.showSupervision).mockImplementationOnce(() => {
        throw failure
      })
    } else {
      vi.mocked(axiomClient.showSupervision).mockRejectedValueOnce(failure)
    }
    await click('Refresh Missions')
    expect(
      within(region).getByText('Supervision settings could not be read. Refresh to try again.')
    ).toBeTruthy()
    expect(within(region).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    expect(
      screen
        .getByRole('region', { name: 'Mission Home' })
        .querySelector('[data-mission-status]')
        ?.getAttribute('data-mission-status')
    ).toBe(mission.status)
    expect(screen.getByText('0 pending item(s)')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Tasks' })).toBeTruthy()
    expect(toast.error).not.toHaveBeenCalled()
  }
})

it('changes the stall mode for the Mission and for all Missions through the Control Plane', async () => {
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  await click('Change for this Mission', region)
  const group = screen.getByRole('radiogroup', { name: 'Stall mode for this Mission' })
  expect(
    within(group)
      .getAllByRole('radio')
      .map((radio) => radio.getAttribute('aria-label'))
  ).toEqual(['default', 'observe', 'notify', 'stop'])
  checked('default')
  saveEnabled(false)
  for (const radio of within(group).getAllByRole('radio')) {
    expect(
      document.getElementById(radio.getAttribute('aria-describedby') ?? '')?.textContent
    ).toBeTruthy()
  }
  await choose('notify')
  saveEnabled(true)
  const read = deferred<View>()
  vi.mocked(axiomClient.showSupervision).mockReturnValueOnce(read.promise)
  await click('Save stall mode', region)
  expect(axiomClient.updateSupervision).toHaveBeenCalledExactlyOnceWith(
    { rule: 'stalled', missionId: mission.id, mode: 'notify' },
    expect.any(String)
  )
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('observe')
  for (const control of within(region).getAllByRole<HTMLButtonElement>('button')) {
    expect(control.disabled).toBe(true)
  }
  for (const control of within(region).getAllByRole<HTMLButtonElement>('radio')) {
    expect(control.disabled).toBe(true)
  }
  const notifyView = view({ missionMode: 'notify', effectiveMode: 'notify' })
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(notifyView)
  await act(async () => read.resolve(notifyView))
  expect(fact(region, 'In effect for this Mission')?.textContent).toContain('notify')
  expect(screen.queryByRole('radiogroup')).toBeNull()
  await click('Change for this Mission', region)
  checked('notify')
  await choose('default')
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(initial)
  await click('Save stall mode', region)
  expect(axiomClient.updateSupervision).toHaveBeenLastCalledWith(
    { rule: 'stalled', missionId: mission.id, mode: null },
    expect.any(String)
  )
  await click('Change the default', region)
  expect(screen.getAllByRole('radio')).toHaveLength(3)
  expect(
    screen.getByRole('radiogroup', { name: 'Default stall mode for all Missions' })
  ).toBeTruthy()
  checked('observe')
  saveEnabled(false)
  await choose('notify')
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(
    view({ globalMode: 'notify', globalSource: 'user', effectiveMode: 'notify' })
  )
  await click('Save stall mode', region)
  expect(axiomClient.updateSupervision).toHaveBeenLastCalledWith(
    { rule: 'stalled', mode: 'notify' },
    expect.any(String)
  )
  expect(fact(region, 'Default for all Missions')?.textContent).toContain('set by you')
  await click('Change for this Mission', region)
  await choose('observe')
  vi.mocked(axiomClient.updateSupervision).mockRejectedValueOnce(
    new AxiomRpcError('stale_state', 'Mode changed elsewhere')
  )
  await click('Save stall mode', region)
  expect(screen.getByRole('alert').textContent).toBe('stale_state: Mode changed elsewhere')
  checked('observe')
  saveEnabled(true)
  expect(toast.error).toHaveBeenCalledWith('stale_state: Mode changed elsewhere')
  await click('Close', region)
  for (const status of TERMINAL_MISSION_STATUSES) {
    vi.mocked(axiomClient.showMission).mockResolvedValue({ mission: { ...mission, status } })
    await click('Refresh Missions')
    expect(within(region).queryByRole('button', { name: 'Change for this Mission' })).toBeNull()
    expect(within(region).getByRole('button', { name: 'Change the default' })).toBeTruthy()
  }
  expect(confirm).not.toHaveBeenCalled()
})

it('asks before stalled Workers are stopped without asking', async () => {
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  for (const scope of ['mission', 'default'] as const) {
    vi.mocked(axiomClient.updateSupervision).mockClear()
    await click(scope === 'mission' ? 'Change for this Mission' : 'Change the default', region)
    await choose('stop')
    const decision = deferred<boolean>()
    confirm.mockReturnValueOnce(decision.promise)
    await click('Save stall mode', region)
    expect(confirm).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Stop stalled Workers automatically',
        confirmLabel: 'Stop stalled Workers automatically',
        cancelLabel: 'Keep the current mode'
      })
    )
    const description = confirm.mock.calls.at(-1)?.[0].description ?? ''
    for (const text of [
      'next supervision pass',
      'without asking',
      'stop is confirmed',
      'work is kept',
      'attempts',
      'blocked until you act'
    ]) {
      expect(description).toContain(text)
    }
    expect(description).toContain(
      scope === 'mission' ? 'this Mission' : 'any Mission without its own setting'
    )
    expect(axiomClient.updateSupervision).not.toHaveBeenCalled()
    for (const control of within(region).getAllByRole<HTMLButtonElement>('button')) {
      expect(control.disabled).toBe(true)
    }
    await act(async () => decision.resolve(false))
    expect(axiomClient.updateSupervision).not.toHaveBeenCalled()
    checked('stop')
    saveEnabled(true)
    const stopped =
      scope === 'mission'
        ? view({ missionMode: 'stop', effectiveMode: 'stop' })
        : view({ globalMode: 'stop', globalSource: 'user', effectiveMode: 'stop' })
    vi.mocked(axiomClient.showSupervision).mockResolvedValue(stopped)
    await click('Save stall mode', region)
    expect(axiomClient.updateSupervision).toHaveBeenCalledExactlyOnceWith(
      { rule: 'stalled', ...(scope === 'mission' ? { missionId: mission.id } : {}), mode: 'stop' },
      expect.any(String)
    )
    expect(screen.queryByRole('radiogroup')).toBeNull()
    expect(fact(region, 'In effect for this Mission')?.textContent).toContain('stop')
    const count = confirm.mock.calls.length
    await click(scope === 'mission' ? 'Change for this Mission' : 'Change the default', region)
    checked('stop')
    await choose('notify')
    vi.mocked(axiomClient.showSupervision).mockResolvedValue(initial)
    await click('Save stall mode', region)
    expect(confirm).toHaveBeenCalledTimes(count)
  }
})

it('shows an open upgrade proposal with its evidence and sends the answer', async () => {
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(view({}, [proposal]))
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending([pendingProposal]))
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  const block = within(region).getByRole('region', { name: 'Upgrade proposal' })
  expect(block.textContent).toContain('default for all Missions')
  expect(within(block).getByText('observe', { exact: true })).toBeTruthy()
  expect(within(block).getAllByText('notify', { exact: true })).toHaveLength(2)
  for (const [label, value] of [
    ['Stalled Attempts with a known outcome', '20'],
    ['Ended badly', '19'],
    ['Passed verification', '1'],
    ['Share that ended badly', '95%'],
    ['Inconclusive outcomes', '3'],
    ['Time acting at the threshold would have saved', '90 minutes']
  ]) {
    expect(fact(block, label)?.textContent).toBe(value)
  }
  expect(block.textContent).toContain('every Mission without its own setting')
  expect(block.textContent).toContain('pending notice')
  expect(block.textContent).toContain('default stays')
  expect(block.textContent).toContain('outcomes are counted afresh')
  expect(block.textContent).toContain('new proposal can follow')
  for (const resolution of ['dismiss', 'accept'] as const) {
    vi.mocked(axiomClient.resolveSupervision).mockClear()
    await click(resolution === 'accept' ? 'Accept proposal' : 'Dismiss proposal', block)
    expect(axiomClient.resolveSupervision).toHaveBeenCalledExactlyOnceWith(
      { proposalId: proposal.id, resolution },
      expect.any(String)
    )
    expect(confirm).not.toHaveBeenCalled()
  }
  const stopProposal = { ...proposal, fromMode: 'notify', toMode: 'stop' }
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(
    view({ globalMode: 'notify', effectiveMode: 'notify' }, [stopProposal])
  )
  await click('Refresh Missions')
  vi.mocked(axiomClient.resolveSupervision).mockClear()
  const decision = deferred<boolean>()
  confirm.mockReturnValueOnce(decision.promise)
  await click('Accept proposal', block)
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Stop stalled Workers automatically',
      description: expect.stringContaining('any Mission without its own setting')
    })
  )
  expect(axiomClient.resolveSupervision).not.toHaveBeenCalled()
  await act(async () => decision.resolve(false))
  expect(axiomClient.resolveSupervision).not.toHaveBeenCalled()
  const reads = vi.mocked(axiomClient.showSupervision).mock.calls.length
  vi.mocked(axiomClient.resolveSupervision).mockRejectedValueOnce(
    new AxiomRpcError('stale_state', 'Default moved')
  )
  await click('Accept proposal', block)
  expect(axiomClient.resolveSupervision).toHaveBeenCalledExactlyOnceWith(
    { proposalId: proposal.id, resolution: 'accept' },
    expect.any(String)
  )
  expect(screen.getByRole('alert').textContent).toBe('stale_state: Default moved')
  expect(axiomClient.showSupervision).toHaveBeenCalledTimes(reads + 1)
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(
    view(
      {},
      ['ACCEPTED', 'DISMISSED', 'SUPERSEDED'].map((status) => ({ ...proposal, id: status, status }))
    )
  )
  await click('Refresh Missions')
  expect(within(region).queryByRole('region', { name: 'Upgrade proposal' })).toBeNull()
})

it('offers the proposal answers only while the pending view lists them', async () => {
  vi.mocked(axiomClient.showSupervision).mockResolvedValue(view({}, [proposal]))
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  const block = within(region).getByRole('region', { name: 'Upgrade proposal' })
  const unavailable = () => {
    expect(within(block).queryByRole('button', { name: 'Accept proposal' })).toBeNull()
    expect(within(block).queryByRole('button', { name: 'Dismiss proposal' })).toBeNull()
    expect(
      within(block).getByText('This proposal cannot be answered from this Mission right now.')
    ).toBeTruthy()
  }
  unavailable()
  for (const item of [
    { ...pendingProposal, objectId: 'another-proposal' },
    { ...pendingProposal, actions: [] }
  ]) {
    vi.mocked(axiomClient.missionPending).mockResolvedValue(pending([item]))
    await click('Refresh Missions')
    unavailable()
  }
  vi.mocked(axiomClient.missionPending).mockRejectedValueOnce(new Error('offline'))
  await click('Refresh Missions')
  unavailable()
  expect(screen.queryByRole('alert')).toBeNull()
  expect(toast.error).not.toHaveBeenCalled()
  vi.mocked(axiomClient.missionPending).mockResolvedValue(pending([pendingProposal]))
  await click('Refresh Missions')
  expect(within(block).getByRole('button', { name: 'Accept proposal' })).toBeTruthy()
  expect(within(block).getByRole('button', { name: 'Dismiss proposal' })).toBeTruthy()
  expect(axiomClient.resolveSupervision).not.toHaveBeenCalled()
})

it('keeps a stall mode choice through a timed tick', async () => {
  await mount()
  const region = screen.getByRole('region', { name: 'Supervision' })
  await click('Change for this Mission', region)
  await choose('notify')
  const radio = screen.getByRole('radio', { name: 'notify' })
  radio.focus()
  const tick = vi.mocked(installWindowVisibilityInterval).mock.calls[0][0].run
  const read = deferred<View>()
  vi.mocked(axiomClient.showSupervision).mockReturnValueOnce(read.promise)
  await act(async () => tick())
  expect(axiomClient.showSupervision).toHaveBeenCalledTimes(2)
  expect(axiomClient.showSupervision).toHaveBeenLastCalledWith({ missionId: mission.id })
  checked('notify')
  saveEnabled(true)
  expect(document.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
  expect(document.activeElement).toBe(radio)
  await act(async () => read.resolve(view({ globalSource: 'user' })))
  checked('notify')
  saveEnabled(true)
  expect(document.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false')
  expect(document.activeElement).toBe(radio)
  const manual = deferred<View>()
  vi.mocked(axiomClient.showSupervision).mockReturnValueOnce(manual.promise)
  let refreshPromise: Promise<void> | undefined
  await act(async () => {
    refreshPromise = controller.refresh(true)
  })
  expect(document.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('true')
  saveEnabled(false)
  expect(refreshPromise).toBeInstanceOf(Promise)
  await act(async () => {
    manual.resolve(initial)
    await refreshPromise
  })
  checked('notify')
  saveEnabled(true)
  expect(installWindowVisibilityInterval).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('status')).toBeNull()
})
