import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDefaultPersistedState } from '../../shared/constants'

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  startCodexHooks: vi.fn(),
  installCodex: vi.fn(),
  installClaude: vi.fn(),
  runtime: {
    setAgentBrowserBridge: vi.fn(),
    setEmulatorBridge: vi.fn(),
    notifyMobileSessionTabsChanged: vi.fn()
  }
}))
vi.mock('electron', () => ({
  app: { getPath: () => '/profile', on: vi.fn(), isPackaged: false },
  nativeTheme: {}
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: true } }))
vi.mock('../star-nag/service', () => ({
  StarNagService: class {
    registerIpcHandlers() {}
  }
}))
vi.mock('../browser/agent-browser-bridge', () => ({
  AgentBrowserBridge: class {
    sweepOrphanedSessions = vi.fn()
  }
}))
vi.mock('../emulator/emulator-bridge', () => ({ EmulatorBridge: class {} }))
vi.mock('../runtime/rpc/dispatcher', () => ({ RpcDispatcher: class {} }))
vi.mock('../browser/browser-manager', () => ({ browserManager: {} }))
vi.mock('../browser/browser-client-page-automation-runtime', () => ({
  configureBrowserClientPageAutomationRuntime: vi.fn()
}))
vi.mock('../crash-reporting/process-gone-diagnostics', () => ({
  startPreGoneCrashSampling: vi.fn()
}))
vi.mock('./main-window-lifecycle-flags', () => ({ recordProcessGoneCrash: vi.fn() }))
vi.mock('./gpu-lifecycle', () => ({ handleGpuChildCrash: vi.fn() }))
vi.mock('../codex/codex-hook-reconcile', () => ({
  startCodexHooks: mocks.startCodexHooks
}))
vi.mock('../agent-hooks/local-agent-cli-presence', () => ({
  detectLocalManagedAgentCliPresence: async () => ({
    claude: { state: 'found' },
    codex: { state: 'found' }
  })
}))
vi.mock('../claude/claude-session-end-hook-capability', () => ({ probeClaudeCliVersion: vi.fn() }))
vi.mock('../agent-hooks/managed-agent-hook-registry', () => ({
  MANAGED_AGENT_HOOK_INSTALLERS: [
    ['claude', mocks.installClaude],
    ['codex', mocks.installCodex]
  ],
  MANAGED_AGENT_HOOK_SCRIPT_REFRESHERS: [],
  MANAGED_AGENT_HOOK_REMOVERS: [],
  MANAGED_AGENT_HOOK_ASYNC_REMOVERS: [],
  MANAGED_AGENT_HOOK_STATUS_READERS: []
}))
vi.mock('../codex/managed-home-shell-preflight', () => ({
  prepareManagedCodexHomeBeforeShellLaunch: vi.fn()
}))
vi.mock('./configure-process', () => ({ shouldInstallManagedHooks: () => true }))
vi.mock('../agent-hooks/install-telemetry', () => ({ recordManagedHookInstallFailure: vi.fn() }))
vi.mock('./main-process-state', () => ({
  mainProcessState: {
    store: {
      getSettings: mocks.getSettings,
      getRepos: () => [],
      getProfileStorageDirectory: () => '/profile'
    },
    codexRuntimeHome: { resolveHostCodexHomePathForLaunchReadOnly: () => null },
    isQuitting: false
  }
}))
vi.mock('./main-process-observers', () => ({ initializeMainProcessObservers: vi.fn() }))
vi.mock('./main-process-account-services', () => ({
  initializeMainProcessAccountServices: vi.fn()
}))
vi.mock('./main-process-runtime-service', () => ({
  initializeMainProcessRuntime: () => mocks.runtime,
  configureRuntimeServices: vi.fn()
}))
vi.mock('./main-process-automations', () => ({ initializeMainProcessAutomations: vi.fn() }))
vi.mock('./main-process-plugins', () => ({ initializeMainProcessPlugins: vi.fn() }))
vi.mock('../worktree-trash', () => ({
  collectWorktreeTrashSweepRoots: vi.fn(),
  sweepStaleWorktreeTrash: vi.fn()
}))
vi.mock('./first-window-deferral', () => ({ runAfterFirstWindowShown: vi.fn() }))
vi.mock('./startup-diagnostics', () => ({ logStartupMilestone: vi.fn() }))
import { initializeReadyRuntimeServices } from './main-process-ready-runtime'

describe('startup hook provider activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.installCodex.mockResolvedValue({ agent: 'codex', state: 'installed' })
    mocks.installClaude.mockResolvedValue({ agent: 'claude', state: 'installed' })
  })
  it.each([false, true])(
    'reconciles Codex only with profile activation=%s while retaining other installers',
    async (activated) => {
      const settings = getDefaultPersistedState('/home').settings
      if (activated) {
        settings.providerActivations = {
          codex: { activatedAt: '2026-10-10T00:00:00.000Z', source: 'agent-launch' }
        }
      }
      mocks.getSettings.mockReturnValue(settings)
      await initializeReadyRuntimeServices()
      await vi.waitFor(() => expect(mocks.installClaude).toHaveBeenCalledOnce())
      // The loop awaits each installer; drain it before asserting absence.
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(mocks.startCodexHooks).toHaveBeenCalledOnce()
      const hookConfig = mocks.startCodexHooks.mock.calls[0][0]
      expect(hookConfig.isEnabled()).toBe(activated)
      expect(hookConfig.resolveLaunchHome()).toBeNull()
      expect(mocks.installCodex).toHaveBeenCalledTimes(activated ? 1 : 0)
    }
  )
})
