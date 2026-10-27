import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GlobalSettings } from '../../shared/global-settings-types'
import type { VerifiedCodexResumeSource } from '../codex/codex-session-resume-preparation'

/**
 * Turning Codex off in the per-agent hook settings removes Orca's Codex hook
 * entry. Launch prep and session resume must read that same opt-out, or the
 * next Codex launch writes the entry straight back.
 */
const SYSTEM_HOME = '/home/user/.codex'
const ACCOUNT_HOME = '/accounts/one/.codex'

const mocks = vi.hoisted(() => {
  const settings: Partial<GlobalSettings> = {}
  return {
    settings,
    selectedHome: '',
    prepareForCodexLaunchAsync: vi.fn(async (): Promise<string | null> => null),
    isHostSystemDefaultRealHomeSelected: vi.fn(() => false),
    prepareRuntimeHomeForLaunch: vi.fn(async () => ({ state: 'ok' as const })),
    installForLaunchPrep: vi.fn(async () => {}),
    refreshRuntimeUserHooksForLaunchPrep: vi.fn(async () => {}),
    reconcileCodexHooksForLaunch: vi.fn(async () => {}),
    prepareCodexSessionResume: vi.fn(),
    reconcileAccount: vi.fn(async () => {})
  }
})

vi.mock('electron', () => ({ app: { getPath: vi.fn(() => '/tmp/orca-user-data') } }))
vi.mock('../agent-trust-presets', () => ({ markCodexProjectTrusted: vi.fn(async () => {}) }))
vi.mock('../codex/hook-service', () => ({
  codexHookService: {
    prepareRuntimeHomeForLaunch: mocks.prepareRuntimeHomeForLaunch,
    installForLaunchPrep: mocks.installForLaunchPrep,
    refreshRuntimeUserHooksForLaunchPrep: mocks.refreshRuntimeUserHooksForLaunchPrep
  }
}))
vi.mock('../codex/codex-hook-reconcile', () => ({
  reconcileCodexHooksForLaunch: mocks.reconcileCodexHooksForLaunch
}))
vi.mock('../codex/codex-account-home-hook', () => ({
  reconcileCodexAccountHomeHook: mocks.reconcileAccount
}))
vi.mock('../codex/codex-account-home-layout', () => ({ layoutCodexAccountHome: vi.fn() }))
// Why: the real predicate, without loading every agent's hook service.
vi.mock(
  '../agent-hooks/managed-agent-hook-controls',
  async () => await import('../../shared/agent-status-hooks-setting')
)
vi.mock('../wsl', () => ({ getDefaultWslDistro: () => 'Ubuntu' }))
vi.mock('../codex/codex-home-paths', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSystemCodexHomePath: () => SYSTEM_HOME,
  usesCodexAccountHomeLayout: (home: string) => home === ACCOUNT_HOME,
  resolveOrcaManagedCodexHomePath: () => '/managed/.codex'
}))
vi.mock('../codex/codex-session-resume-preparation', () => ({
  prepareCodexSessionResume: mocks.prepareCodexSessionResume
}))
vi.mock('../codex/codex-legacy-session-resume', () => ({
  prepareLegacySharedCodexSessionResume: vi.fn(async () => ({ useRealCodexHome: false }))
}))
vi.mock('./main-process-state', () => ({
  mainProcessState: {
    codexRuntimeHome: {
      prepareForCodexLaunchAsync: mocks.prepareForCodexLaunchAsync,
      isHostSystemDefaultRealHomeSelected: mocks.isHostSystemDefaultRealHomeSelected,
      getHostCodexHomePathsForSessionDiscovery: () => [],
      resolveSelectedHostAccountCodexHomePathForResume: () => mocks.selectedHome || null,
      getSelectedHostAccountCodexHomePath: () => mocks.selectedHome || null
    },
    store: {
      getSettings: () => mocks.settings,
      updateSettings: (updates: Partial<GlobalSettings>) => Object.assign(mocks.settings, updates)
    }
  }
}))

import { prepareCodexRuntimeHomeForLaunch } from './codex-launch-preparation'
import { prepareCodexSessionResumeForLaunch } from './codex-session-resume-launch'

const HOOK_SETTINGS: readonly {
  name: string
  settings: Partial<GlobalSettings>
  codexHooksOn: boolean
}[] = [
  {
    name: 'Codex turned off per agent',
    settings: { agentStatusHooksEnabled: true, disabledTuiAgents: ['codex'] },
    codexHooksOn: false
  },
  {
    name: 'every agent on',
    settings: { agentStatusHooksEnabled: true, disabledTuiAgents: [] },
    codexHooksOn: true
  },
  {
    name: 'another agent turned off',
    settings: { agentStatusHooksEnabled: true, disabledTuiAgents: ['claude'] },
    codexHooksOn: true
  },
  {
    name: 'the global switch off',
    settings: { agentStatusHooksEnabled: false, disabledTuiAgents: [] },
    codexHooksOn: false
  }
]

/** The hooks-setting reader a launch passes, matched by what it reads now. */
function readsSetting(enabled: boolean): { asymmetricMatch: (reader: unknown) => boolean } {
  return { asymmetricMatch: (reader) => typeof reader === 'function' && reader() === enabled }
}

function resumeFrom(homePath: string): Promise<unknown> {
  mocks.prepareCodexSessionResume.mockImplementation(
    async (args: {
      resolveVerifiedResumeHome: (source: VerifiedCodexResumeSource) => Promise<string>
    }) => {
      const codexHomePath = await args.resolveVerifiedResumeHome({
        homePath,
        transcriptPath: `${homePath}/sessions/abc.jsonl`
      })
      return { outcome: 'resume' as const, codexHomePath, sessionId: 'abc' }
    }
  )
  return prepareCodexSessionResumeForLaunch({
    providerSession: { key: 'session_id', id: 'abc' },
    target: { runtime: 'host' }
  })
}

describe('Codex launch prep honours the per-agent hook opt-out', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.selectedHome = ACCOUNT_HOME
    mocks.isHostSystemDefaultRealHomeSelected.mockReturnValue(false)
    mocks.prepareForCodexLaunchAsync.mockResolvedValue(null)
  })

  it.each(HOOK_SETTINGS)('no-account launch refuses with $name', async ({ settings }) => {
    mocks.settings = settings
    mocks.isHostSystemDefaultRealHomeSelected.mockReturnValue(true)

    await expect(
      prepareCodexRuntimeHomeForLaunch(undefined, undefined, { launchesCodex: true })
    ).rejects.toMatchObject({ code: 'no_account' })

    // D83: a missing account is refused before any real-home hook reconciliation.
    expect(mocks.reconcileCodexHooksForLaunch).not.toHaveBeenCalled()
    expect(mocks.prepareRuntimeHomeForLaunch).not.toHaveBeenCalled()
  })

  it.each(HOOK_SETTINGS)(
    'managed account home launch with $name: hooks on = $codexHooksOn',
    async ({ settings, codexHooksOn }) => {
      mocks.settings = settings
      mocks.prepareForCodexLaunchAsync.mockResolvedValue(ACCOUNT_HOME)

      await expect(
        prepareCodexRuntimeHomeForLaunch(undefined, undefined, { launchesCodex: true })
      ).resolves.toBe(ACCOUNT_HOME)

      expect(mocks.reconcileCodexHooksForLaunch).not.toHaveBeenCalled()
      expect(mocks.prepareRuntimeHomeForLaunch).not.toHaveBeenCalled()
      expect(mocks.reconcileAccount).toHaveBeenCalledWith(
        ACCOUNT_HOME,
        readsSetting(codexHooksOn),
        true
      )
    }
  )

  it.each(HOOK_SETTINGS)('real-home history stays view only with $name', async ({ settings }) => {
    mocks.settings = settings

    await expect(resumeFrom(SYSTEM_HOME)).rejects.toMatchObject({ code: 'no_account' })

    // D83: real-home sessions remain discoverable but cannot resume.
    expect(mocks.reconcileCodexHooksForLaunch).not.toHaveBeenCalled()
    expect(mocks.installForLaunchPrep).not.toHaveBeenCalled()
    expect(mocks.refreshRuntimeUserHooksForLaunchPrep).not.toHaveBeenCalled()
  })

  it.each(HOOK_SETTINGS)(
    'resume into a managed account home with $name: hooks on = $codexHooksOn',
    async ({ settings, codexHooksOn }) => {
      mocks.settings = settings

      await resumeFrom(ACCOUNT_HOME)

      expect(mocks.reconcileCodexHooksForLaunch).not.toHaveBeenCalled()
      expect(mocks.reconcileAccount).toHaveBeenCalledWith(
        ACCOUNT_HOME,
        readsSetting(codexHooksOn),
        true
      )
      expect(mocks.installForLaunchPrep).not.toHaveBeenCalled()
      expect(mocks.refreshRuntimeUserHooksForLaunchPrep).not.toHaveBeenCalled()
    }
  )

  it("never makes a plain terminal or a structured launch wait for Codex's hook hashes", async () => {
    mocks.settings = {
      agentStatusHooksEnabled: true,
      disabledTuiAgents: [],
      providerActivations: {
        codex: { activatedAt: '2026-10-23T00:00:00.000Z', source: 'agent-launch' }
      }
    }
    mocks.prepareForCodexLaunchAsync.mockResolvedValue(ACCOUNT_HOME)

    await prepareCodexRuntimeHomeForLaunch()
    await prepareCodexRuntimeHomeForLaunch(undefined, undefined, { launchesCodex: false })
    mocks.prepareForCodexLaunchAsync.mockResolvedValue(null)
    mocks.selectedHome = ''
    await prepareCodexRuntimeHomeForLaunch()

    expect(mocks.reconcileAccount.mock.calls).toEqual([
      [ACCOUNT_HOME, readsSetting(true), false],
      [ACCOUNT_HOME, readsSetting(true), false]
    ])
    expect(mocks.reconcileCodexHooksForLaunch).not.toHaveBeenCalled()
  })
})
