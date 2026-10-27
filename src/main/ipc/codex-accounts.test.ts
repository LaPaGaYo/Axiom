import { afterEach, expect, it, vi } from 'vitest'
import { registerCodexAccountHandlers } from './codex-accounts'

const handlers = vi.hoisted(
  () =>
    new Map<
      string,
      (
        event: unknown,
        args: { accountId: null; runtime?: 'host' | 'wsl'; wslDistro?: string }
      ) => unknown
    >()
)
vi.mock('electron', () => ({
  ipcMain: {
    handle: (name: string, handler: typeof handlers extends Map<string, infer H> ? H : never) =>
      handlers.set(name, handler)
  }
}))
afterEach(() => {
  vi.restoreAllMocks()
  handlers.clear()
})

it.each(['darwin', 'linux', 'win32'] as const)(
  'IPC null selection respects the %s host boundary',
  (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    const select = vi.fn()
    const service = {
      onPendingLoginUrlChanged: vi.fn(),
      setWslLoginUrlOpener: vi.fn(),
      selectAccount: select,
      selectAccountForTarget: select
    }
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only registration listeners and the selection handler use this fixture.
    registerCodexAccountHandlers(service as never)
    const selectNull = () => handlers.get('codexAccounts:select')!(null, { accountId: null })
    if (platform === 'win32') {
      selectNull()
      expect(select).toHaveBeenCalledWith(null)
    } else {
      expect(selectNull).toThrow(expect.objectContaining({ code: 'system_default_retired' }))
      expect(select).not.toHaveBeenCalled()
    }
    handlers.get('codexAccounts:select')!(null, {
      accountId: null,
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
    expect(select).toHaveBeenCalledWith(null, {
      accountId: null,
      runtime: 'wsl',
      wslDistro: 'Ubuntu'
    })
  }
)
