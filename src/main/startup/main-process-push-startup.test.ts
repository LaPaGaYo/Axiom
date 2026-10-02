import { afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  start: vi.fn(),
  fetch: vi.fn(),
  state: { runtime: {}, desktopPushService: null }
}))
vi.mock('electron', () => ({ app: { isPackaged: true }, net: { fetch: mocks.fetch } }))
vi.mock('./main-process-state', () => ({ mainProcessState: mocks.state }))
vi.mock('../runtime/push/desktop-push-service', () => ({
  DesktopPushService: { create: mocks.create }
}))
vi.mock('../runtime/runtime-rpc', () => ({ OrcaRuntimeRpcServer: vi.fn() }))
import { OrcaRuntimeRpcServer } from '../runtime/runtime-rpc'
import { startDesktopPushService } from './main-process-push-startup'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('packaged desktop and serve push startup', () => {
  it('starts the existing service with an explicit gateway', () => {
    vi.stubEnv('ORCA_PUSH_GATEWAY_URL', 'https://push.example')
    mocks.create.mockReturnValue({ start: mocks.start })
    startDesktopPushService(OrcaRuntimeRpcServer.prototype)
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ gatewayUrl: 'https://push.example' })
    )
    expect(mocks.start).toHaveBeenCalledOnce()
  })
  it('does not create a push client without a gateway', () => {
    vi.stubEnv('ORCA_PUSH_GATEWAY_URL', '')
    vi.stubGlobal('fetch', mocks.fetch)
    const log = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    // The unconfigured path must return before consulting runtime RPC facilities.
    startDesktopPushService(OrcaRuntimeRpcServer.prototype)
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith('[push] Background push startup skipped: gateway unconfigured')
  })
})
