import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TuiAgent } from '../../../../shared/tui-agent'
import { closeTestStores, createStore, testState } from '../../../persistence-test-harness'
import { recordProviderActivation } from '../../../provider-activation/provider-activation'
import { commitPtyIpcSpawn } from './spawn-commit'
import { commitPtySpawn } from '../spawn-commit-assembly'
import { createPtyIpcSpawnState } from './spawn-state'
import type { PtySpawnIpcDeps } from './spawn-types'

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
vi.mock('../spawn-commit-assembly', () => ({
  commitPtySpawn: vi.fn(async () => ({ id: 'activation-test-pty', cols: 80, rows: 24 }))
}))

function spawnContext(launchAgent?: TuiAgent) {
  const store = createStore()
  const updateSettings = vi.spyOn(store, 'updateSettings')
  const deps: PtySpawnIpcDeps = {
    store,
    getLocalPtyStartupPromise: vi.fn(),
    adoptStablePane: vi.fn(),
    resolvePtySpawnStartupCwd: vi.fn(),
    assertWorkspaceAcceptsNewPty: vi.fn(),
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
      expect(commitPtySpawn).toHaveBeenCalledOnce()
      expect(updateSettings.mock.invocationCallOrder[0]).toBeGreaterThan(
        vi.mocked(commitPtySpawn).mock.invocationCallOrder[0]!
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
    vi.mocked(commitPtySpawn).mockRejectedValueOnce(new Error('save failed'))
    await expect(commitPtyIpcSpawn(ctx)).rejects.toThrow('save failed')
    expect(store.updateSettings).not.toHaveBeenCalled()
  })

  it('does not activate when registration rejects an exited spawn', async () => {
    const { ctx, store } = spawnContext('claude')
    vi.mocked(commitPtySpawn).mockReturnValueOnce(
      Promise.reject(new Error('agent_session_exited_during_start'))
    )
    await expect(commitPtyIpcSpawn(ctx)).rejects.toThrow('agent_session_exited_during_start')
    expect(store.updateSettings).not.toHaveBeenCalled()
  })
})
