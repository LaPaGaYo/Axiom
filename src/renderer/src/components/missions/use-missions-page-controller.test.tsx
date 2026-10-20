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
  policy,
  attempt,
  message
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
  useAppStore.setState({
    selectedMissionId: mission.id,
    selectedTaskId: null,
    missionRequests: {},
    missionError: null
  })
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
    if (method === 'axiom.attempt.list') {
      return success({ attempts: [attempt] })
    }
    if (method === 'axiom.message.list') {
      return success({ messages: [message] })
    }
    throw new Error(`Unexpected method: ${method}`)
  })
})
afterEach(() => {
  act(() => root.render(null))
  vi.unstubAllGlobals()
})

describe('Mission page reconciliation', () => {
  it('loads Task detail and re-reads pending messages after an uncertain answer', async () => {
    await mount()
    await act(async () => controller.selectTask(attempt.taskId))
    expect(controller.taskDetail?.messages).toEqual([message])
    expect(
      call.mock.calls.some(
        ([a]) => a.method === 'axiom.attempt.list' && a.params.taskId === attempt.taskId
      )
    ).toBe(true)
    const base = call.getMockImplementation()!
    call.mockImplementation((args) =>
      args.method === 'axiom.message.answer'
        ? Promise.reject(new Error('lost response'))
        : base(args)
    )
    const before = call.mock.calls.length
    await act(async () => controller.answer(message.id, 'Use A'))
    expect(
      call.mock.calls
        .slice(before)
        .some(([a]) => a.method === 'axiom.message.list' && a.params.pendingOnly)
    ).toBe(true)
    await act(async () => controller.answer(message.id, 'Use A'))
    const answers = call.mock.calls.filter(([a]) => a.method === 'axiom.message.answer')
    expect(answers[0][0]).toEqual(answers[1][0])
    await act(async () => controller.select('mission-2'))
    expect(useAppStore.getState().selectedTaskId).toBeNull()
    expect(controller.taskDetail).toBeNull()
  })
  it('holds the Planner busy state until its response and reconciles subtask resolution', async () => {
    await mount()
    const base = call.getMockImplementation()!
    let settle: ((value: unknown) => void) | undefined
    call.mockImplementation((args) => {
      if (args.method === 'axiom.mission.plan') {
        return new Promise((resolve) => {
          settle = resolve
        })
      }
      if (args.method === 'axiom.message.resolve') {
        return Promise.resolve(
          success({ resolved: true, decision: 'accept', reason: 'In scope', taskId: 'new-task' })
        )
      }
      return base(args)
    })
    act(() => {
      controller.missionAction('plan')
      controller.missionAction('plan')
    })
    expect(controller.busy).toBe(true)
    expect(call.mock.calls.filter(([a]) => a.method === 'axiom.mission.plan')).toHaveLength(1)
    await act(async () => settle?.(success({ attempt })))
    expect(controller.busy).toBe(false)
    const before = call.mock.calls.length
    await act(async () => controller.resolve('subtask', 'accept', 'In scope'))
    expect(call.mock.calls.slice(before).some(([a]) => a.method === 'axiom.task.list')).toBe(true)
  })
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
