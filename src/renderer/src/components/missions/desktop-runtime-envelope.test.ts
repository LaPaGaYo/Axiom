import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRuntimeCall } from '../../../../preload/api-types'

const { handlers, dispatch, invoke } = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, args: DesktopRuntimeCall) => Promise<unknown>>(),
  dispatch: vi.fn(),
  invoke: vi.fn()
}))
vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: vi.fn() },
  ipcMain: {
    handle: (
      name: string,
      handler: (event: unknown, args: DesktopRuntimeCall) => Promise<unknown>
    ) => handlers.set(name, handler),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
    on: vi.fn()
  },
  ipcRenderer: { invoke, on: vi.fn(), removeListener: vi.fn(), send: vi.fn() }
}))
vi.mock('../../../../main/runtime/rpc/methods', () => ({ ALL_RPC_METHODS: [] }))
vi.mock('../../../../main/runtime/rpc/dispatcher', () => ({
  RpcDispatcher: class {
    dispatch = dispatch
  }
}))
type RuntimeDouble = { getRuntimeId: () => string }

// Load the real node-only IPC module without adding its graph to the renderer TS project.
// SAFETY: this is its exported signature; Electron and the dispatcher are mocked above.
const { registerRuntimeHandlers } = await vi.importActual<{
  registerRuntimeHandlers(runtime: RuntimeDouble): void
}>('../../../../main/ipc/runtime')
import { runtimeApi } from '../../../../preload/api/runtime-bridge'

beforeEach(() => {
  dispatch
    .mockReset()
    .mockResolvedValue({ id: 'desktop-ipc', ok: true, result: {}, _meta: { runtimeId: 'r' } })
  invoke.mockReset()
  handlers.clear()
  registerRuntimeHandlers({ getRuntimeId: () => 'runtime-test' })
  const mainFrame = {}
  const event = { sender: { id: 1, mainFrame, on: vi.fn(), once: vi.fn() }, senderFrame: mainFrame }
  invoke.mockImplementation((channel: string, args: DesktopRuntimeCall) =>
    handlers.get(channel)?.(event, args)
  )
})

describe('desktop runtime envelope', () => {
  it('forwards only the two declared envelope fields through preload to dispatch', async () => {
    const args = {
      method: 'axiom.mission.start',
      params: { missionId: 'm' },
      envelope: {
        orchestrationContractVersion: 1,
        orchestrationRequestId: 'action-1',
        authToken: 'untrusted'
      }
    }
    await runtimeApi.call(args)
    expect(dispatch.mock.calls[0][0]).toEqual({
      id: 'desktop-ipc',
      authToken: 'desktop-ipc',
      method: args.method,
      params: args.params,
      orchestrationContractVersion: 1,
      orchestrationRequestId: 'action-1'
    })
  })
  it('preserves the exact request shape for existing callers without an envelope', async () => {
    await runtimeApi.call({ method: 'status.get', params: {} })
    expect(dispatch.mock.calls[0][0]).toEqual({
      id: 'desktop-ipc',
      authToken: 'desktop-ipc',
      method: 'status.get',
      params: {}
    })
  })
})
