import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { closeTestStores, createStore, testState } from '../../../persistence-test-harness'
import { recordProviderActivation } from '../../../provider-activation/provider-activation'
import { commitPtyIpcSpawn } from './spawn-commit'
import { persistPtyIpcSpawnCommit } from './spawn-commit-persist'
import { createPtyIpcSpawnState } from './spawn-state'
import type { PtySpawnIpcDeps } from './spawn-types'
import { registerPersistedPtySpawn } from '../pane/spawn-registration'

vi.mock('electron', () => ({
  app: { getPath: () => testState.dir },
  safeStorage: { isEncryptionAvailable: () => false }
}))
vi.mock('../../../memory/pty-registry', () => ({ registerPty: vi.fn() }))
vi.mock('../provider/registry', () => ({ localProvider: {} }))
vi.mock('../host-env/codex-home', () => ({
  shouldSkipCodexHomeEnvForWindowsShell: () => false,
  codexReattachedHomeRouteField: () => ({})
}))
vi.mock('../pane/agent-session-owners', () => ({
  seedTerminalRestoreRecordsFromSpawnResult: vi.fn()
}))
vi.mock('../pane/spawn-registration', () => ({
  admitPtyReattachOwnership: vi.fn(),
  registerPersistedPtySpawn: vi.fn()
}))
vi.mock('./spawn-commit-persist', () => ({
  persistPtyIpcSpawnCommit: vi.fn(async () => ({ cols: 80, rows: 24 })),
  publishPtyIpcSpawnCommit: vi.fn()
}))

function spawnContext(launchAgent?: TuiAgent) {
  const store = createStore()
  const updateSettings = vi.spyOn(store, 'updateSettings')
  const deps: PtySpawnIpcDeps = {
    store,
    getLocalPtyStartupPromise: vi.fn(),
    adoptStablePane: vi.fn(),
    assertFolderWorkspacePtyPathUsable: vi.fn(),
    resolvePtySpawnStartupCwd: vi.fn(),
    localStartupCwdDirectoryExists: vi.fn(),
    prepareCodexResumeHome: vi.fn(),
    noCodexResumeLaunch: vi.fn(),
    resolveCodexResumeLaunch: vi.fn(),
    reconcileSharedRuntimeResumeHome: vi.fn(),
    stripSequencedStartupResumeArgv: (env) => env,
    transitionSpawnHiddenRendererPtyDeliveryState: vi.fn(),
    trustedTerminalHandleEnv: new Set(),
    sendPtySpawnedToRenderer: vi.fn(),
    syncPtyBackgroundedDelivery: vi.fn(),
    stopReplacedPty: vi.fn()
  }
  const ctx = createPtyIpcSpawnState(deps, {
    cols: 80,
    rows: 24,
    worktreeId: 'repo::/worktree',
    launchAgent
  })
  ctx.result = { id: 'activation-test-pty' }
  return { ctx, store, updateSettings }
}

describe('PTY spawn provider activation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    testState.dir = mkdtempSync(join(tmpdir(), 'axiom-spawn-activation-'))
  })

  afterEach(async () => {
    await closeTestStores()
    rmSync(testState.dir, { recursive: true, force: true })
  })

  it.each<TuiAgent>(['claude', 'gemini', 'kimi', 'grok', 'antigravity', 'cursor', 'codex'])(
    'activates %s after an admitted launch',
    async (agent) => {
      const { ctx, store, updateSettings } = spawnContext(agent)
      await commitPtyIpcSpawn(ctx)
      expect(store.getSettings().providerActivations).toEqual({
        [agent]: { activatedAt: expect.any(String), source: 'agent-launch' }
      })
      expect(registerPersistedPtySpawn).toHaveBeenCalledOnce()
      expect(updateSettings.mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(registerPersistedPtySpawn).mock.invocationCallOrder[0]!
      )
    }
  )

  it('does not activate a provider for a plain shell', async () => {
    const { ctx, store } = spawnContext()
    await commitPtyIpcSpawn(ctx)
    expect(store.getSettings().providerActivations).toEqual({})
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('does not activate on reattach even when the request names an agent', async () => {
    const { ctx, store } = spawnContext('claude')
    ctx.result.isReattach = true
    await commitPtyIpcSpawn(ctx)
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('does not alias an agent id to a usage provider', async () => {
    const { ctx, store } = spawnContext('opencode')
    await commitPtyIpcSpawn(ctx)
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('preserves activation already recorded by Codex launch preparation', async () => {
    const { ctx, store } = spawnContext('codex')
    recordProviderActivation(store, 'codex', 'agent-launch')
    const original = store.getSettings().providerActivations?.codex
    await commitPtyIpcSpawn(ctx)
    expect(store.getSettings().providerActivations?.codex).toEqual(original)
    expect(store.updateSettings).toHaveBeenCalledOnce()
  })

  it('does not activate when persistence fails before admission', async () => {
    const { ctx, store } = spawnContext('claude')
    vi.mocked(persistPtyIpcSpawnCommit).mockRejectedValueOnce(new Error('save failed'))
    await expect(commitPtyIpcSpawn(ctx)).rejects.toThrow('save failed')
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('does not activate when registration rejects an exited spawn', async () => {
    const { ctx, store } = spawnContext('claude')
    vi.mocked(registerPersistedPtySpawn).mockReturnValueOnce(
      Promise.reject(new Error('agent_session_exited_during_start'))
    )
    await commitPtyIpcSpawn(ctx)
    expect(store.updateSettings).not.toHaveBeenCalled()
  })
})
