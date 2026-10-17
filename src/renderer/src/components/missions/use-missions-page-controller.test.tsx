// @vitest-environment happy-dom
import type { MissionsSlice } from '@/store/slices/missions'
import type { TopLevelView } from '../../../../shared/ui-chrome-types'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConfirmationDialogContext } from '@/components/confirmation-dialog-context'
import {
  goal,
  mission,
  policy
} from '../../../../shared/axiom-contract/contract-fixtures.test-support'

vi.mock('@/store', async () => {
  const { create } = await import('zustand')
  const { createMissionsSlice } = await import('@/store/slices/missions')
  const useAppStore = create<
    MissionsSlice & {
      activeView: TopLevelView
    }
  >()((...a) => ({ activeView: 'terminal', ...createMissionsSlice(...a) }))
  return { useAppStore }
})
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }))
import { useAppStore } from '@/store'
import {
  useMissionsPageController,
  type MissionsPageController
} from './use-missions-page-controller'
import { toast } from 'sonner'

const call = vi.fn()
const confirm = vi.fn(async () => true)
const container = document.createElement('div')
const root = createRoot(container)
let controller: MissionsPageController
const success = (result: unknown) => ({
  id: 'desktop-ipc',
  ok: true,
  result,
  _meta: { runtimeId: 'r' }
})
const goalRevision = { ...goal, id: 'g', missionId: mission.id, revision: 1, status: 'ACTIVE' }
function Harness() {
  controller = useMissionsPageController()
  return (
    <div>
      {controller.detail?.mission.id}:{controller.detail?.mission.status}
    </div>
  )
}
async function mount() {
  await act(async () =>
    root.render(
      <ConfirmationDialogContext.Provider value={confirm}>
        <Harness />
      </ConfirmationDialogContext.Provider>
    )
  )
}
beforeEach(() => {
  vi.stubGlobal('window', { api: { runtime: { call } } })
  useAppStore.setState({ selectedMissionId: mission.id, missionRequests: {}, missionError: null })
  call.mockReset().mockImplementation(async ({ method, params }) => {
    if (method === 'axiom.mission.list') {
      return success({ missions: [mission] })
    }
    if (method === 'axiom.mission.show') {
      return success({ mission: { ...mission, id: params.missionId, status: 'PLANNED' } })
    }
    if (method === 'axiom.task.list') {
      return success({ tasks: [] })
    }
    if (method === 'axiom.plan.list') {
      return success({ planRevisions: [] })
    }
    throw new Error(`Unexpected method: ${method}`)
  })
})
afterEach(() => {
  act(() => root.render(null))
  vi.unstubAllGlobals()
})

describe('Mission page reconciliation', () => {
  it('prevents double clicks and never displays a mutation response as status', async () => {
    await mount()
    let settle: ((value: unknown) => void) | undefined
    const base = call.getMockImplementation()!
    call.mockImplementation((args) =>
      args.method === 'axiom.mission.start'
        ? new Promise((resolve) => {
            settle = resolve
          })
        : base(args)
    )
    act(() => {
      controller.missionAction('start')
      controller.missionAction('start')
    })
    expect(call.mock.calls.filter(([args]) => args.method === 'axiom.mission.start')).toHaveLength(
      1
    )
    expect(container.textContent).toContain('PLANNED')
    await act(async () => settle?.(success({ mission: { ...mission, status: 'EXECUTING' } })))
    // Server re-read deliberately disagrees with the mutation response.
    expect(container.textContent).toContain('PLANNED')
    expect(container.textContent).not.toContain('EXECUTING')
    expect(call.mock.calls.filter(([args]) => args.method === 'axiom.task.list')).toHaveLength(2)
  })
  it('reuses the same receipt id after an uncertain create result and reads the created Mission', async () => {
    await mount()
    const base = call.getMockImplementation()!
    let attempts = 0
    call.mockImplementation((args) => {
      if (args.method !== 'axiom.mission.create') {
        return base(args)
      }
      attempts += 1
      if (attempts === 1) {
        return Promise.reject(new Error('connection lost after commit'))
      }
      return Promise.resolve(success({ mission, goalRevision, policy }))
    })
    const params = { repo: '/repo', targetBranch: 'main', goal, policy }
    await act(async () => controller.create(params))
    expect(toast.error).toHaveBeenCalledWith('transport_error: connection lost after commit')
    await act(async () => controller.create(params))
    const writes = call.mock.calls.filter(([args]) => args.method === 'axiom.mission.create')
    expect(writes[0][0]).toEqual(writes[1][0])
    expect(container.textContent).toContain(mission.id)
    expect(useAppStore.getState().missionRequests).toEqual({})
  })
  it('discards a stale response after another Mission is selected', async () => {
    await mount()
    const base = call.getMockImplementation()!
    let settle: ((value: unknown) => void) | undefined
    call.mockImplementation((args) =>
      args.method === 'axiom.mission.show' && args.params.missionId === mission.id
        ? new Promise((resolve) => {
            settle = resolve
          })
        : base(args)
    )
    let refresh: Promise<void>
    act(() => {
      refresh = controller.refresh()
    })
    await act(async () => useAppStore.getState().selectMission('mission-2'))
    expect(container.textContent).toContain('mission-2')
    await act(async () => {
      settle?.(success({ mission }))
      await refresh!
    })
    expect(container.textContent).toContain('mission-2')
    expect(container.textContent).not.toContain('mission-1')
  })
})

it('requires confirmation with consequences before canceling or rejecting', async () => {
  await mount()
  confirm.mockResolvedValueOnce(false)
  await act(async () => controller.missionAction('cancel'))
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Cancel Mission',
      description: expect.stringContaining('cannot be resumed'),
      confirmVariant: 'destructive'
    })
  )
  expect(call.mock.calls.some(([args]) => args.method === 'axiom.mission.cancel')).toBe(false)
  confirm.mockResolvedValueOnce(false)
  await act(async () => controller.reject('plan-1', 'Missing acceptance coverage'))
  expect(confirm).toHaveBeenLastCalledWith(
    expect.objectContaining({
      title: 'Reject plan',
      description: expect.stringContaining('new proposal'),
      confirmVariant: 'destructive'
    })
  )
  expect(call.mock.calls.some(([args]) => args.method === 'axiom.plan.reject')).toBe(false)
})
