import { afterEach, expect, it, vi } from 'vitest'
import { buildCodexStatusSwitchGroups } from './status-bar-codex-accounts'
import { getRendererAppPlatform } from '../../lib/renderer-app-platform'
import type { CodexRateLimitAccountsState } from '../../../../shared/managed-account-types'

vi.mock('../../lib/renderer-app-platform', () => ({
  getRendererAppPlatform: vi.fn(() => 'darwin')
}))
afterEach(() => vi.clearAllMocks())
const state: CodexRateLimitAccountsState = {
  accounts: [],
  activeAccountId: null,
  systemDefault: {
    hasAuth: false,
    authKind: 'none',
    email: null,
    providerAccountId: null,
    workspaceLabel: null
  }
}
it.each(['darwin', 'linux', 'win32'] as const)(
  'removes even a stale system-default snapshot from the %s host switcher',
  (platform) => {
    vi.mocked(getRendererAppPlatform).mockReturnValue(platform)
    const groups = buildCodexStatusSwitchGroups(state, { runtime: 'host', wslDistro: null })
    expect(groups[0].targets).toHaveLength(platform === 'win32' ? 1 : 0)
  }
)
it('keeps remote and WSL switcher lanes', () => {
  vi.mocked(getRendererAppPlatform).mockReturnValue('darwin')
  const groups = buildCodexStatusSwitchGroups(
    state,
    { runtime: 'wsl', wslDistro: 'Ubuntu' },
    { legacyHostDefault: true }
  )
  expect(groups.map((group) => group.targets.map((target) => target.id))).toEqual([[null], [null]])
})
