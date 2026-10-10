import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../shared/constants'

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(),
  prepareHooks: vi.fn(),
  trust: vi.fn(),
  runtimeHome: {
    isHostSystemDefaultRealHomeSelected: vi.fn(),
    prepareForCodexLaunchAsync: vi.fn()
  },
  getSettings: vi.fn(),
  updateSettings: vi.fn()
}))
vi.mock('electron', () => ({ app: { getPath: () => '/test/profile' } }))
vi.mock('../codex/codex-real-home-hook-install', () => ({
  ensureRealHomeCodexHookState: mocks.ensure
}))
vi.mock('../codex/hook-service', () => ({
  codexHookService: { prepareRuntimeHomeForLaunch: mocks.prepareHooks }
}))
vi.mock('../agent-trust-presets', () => ({ markCodexProjectTrusted: mocks.trust }))
vi.mock('../wsl', () => ({ getDefaultWslDistro: () => 'Ubuntu' }))
vi.mock('../agent-hooks/managed-agent-hook-controls', () => ({
  isAgentStatusHooksEnabled: () => true
}))
vi.mock('./main-process-state', () => ({
  mainProcessState: {
    codexRuntimeHome: mocks.runtimeHome,
    store: { getSettings: mocks.getSettings, updateSettings: mocks.updateSettings }
  }
}))
import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'

describe('Codex launch activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let settings = getDefaultPersistedState('/test/home').settings
    mocks.getSettings.mockImplementation(() => settings)
    mocks.updateSettings.mockImplementation((updates) => {
      settings = { ...settings, ...updates }
      return settings
    })
    mocks.runtimeHome.isHostSystemDefaultRealHomeSelected.mockReturnValue(true)
    mocks.runtimeHome.prepareForCodexLaunchAsync.mockResolvedValue(null)
    mocks.ensure.mockResolvedValue(undefined)
    mocks.prepareHooks.mockResolvedValue({ state: 'installed' })
  })
  it('prepares a generic shell without a Codex trust session or activation', async () => {
    await prepareCodexRuntimeHomeForLaunch(undefined, undefined, {})
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.prepareHooks).not.toHaveBeenCalled()
    expect(mocks.updateSettings).not.toHaveBeenCalled()
  })
  it('records an explicit Codex launch before granting real-home hooks', async () => {
    mocks.ensure.mockImplementation(async () => {
      expect(mocks.getSettings().providerActivations.codex.source).toBe('agent-launch')
    })
    await prepareCodexRuntimeHomeForLaunch(undefined, undefined, {
      launchAgent: 'codex',
      workspacePath: '/repo'
    })
    expect(mocks.ensure).toHaveBeenCalledOnce()
    expect(mocks.trust).toHaveBeenCalledWith('/repo')
  })
  it('records a WSL launch before preparing its managed hooks', async () => {
    mocks.runtimeHome.prepareForCodexLaunchAsync.mockResolvedValue('/wsl/home')
    await prepareCodexRuntimeHomeForLaunch({ runtime: 'wsl', wslDistro: 'Ubuntu' }, undefined, {
      launchAgent: 'codex'
    })
    expect(mocks.getSettings().providerActivations.codex.source).toBe('agent-launch')
    expect(mocks.ensure).not.toHaveBeenCalled()
    expect(mocks.prepareHooks).toHaveBeenCalledWith(
      '/wsl/home',
      { runtime: 'wsl', wslDistro: 'Ubuntu' },
      true
    )
  })
})
