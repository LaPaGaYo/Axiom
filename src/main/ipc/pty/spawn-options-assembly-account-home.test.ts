import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { getDefaultSettings } from '../../../shared/constants'
import { assemblePtySpawnLaunchOptions } from './spawn-options-assembly'

const mocks = vi.hoisted(() => ({ user: '', trust: vi.fn(() => null) }))
vi.mock('node:os', async () => ({
  ...(await vi.importActual<typeof NodeOs>('node:os')),
  homedir: () => mocks.user
}))
vi.mock('../../agent-workspace-trust-spawn', () => ({
  applyAgentWorkspaceTrustToSpawn: mocks.trust
}))
vi.mock('../../pty/codex-no-daemon-launch-command', () => ({ planCodexNoDaemonLaunch: () => null }))
vi.mock('../../opencode/opencode-pty-launch', () => ({
  prepareOpenCodePtyLaunch: async (input: { command: string; env: Record<string, string> }) => input
}))
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

it.each([
  { platform: 'darwin', lane: 'account', trusted: true },
  { platform: 'linux', lane: 'account', trusted: true },
  { platform: 'win32', lane: 'account', trusted: false },
  { platform: 'linux', lane: 'wsl', trusted: false },
  { platform: 'linux', lane: 'system', trusted: false },
  { platform: 'linux', lane: 'mirror', trusted: false }
] as const)('routes PTY trust for $platform / $lane', async ({ platform, lane, trusted }) => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-pty-trust-'))
  mocks.user = join(root, 'user')
  const userData = join(root, 'data')
  vi.stubEnv('ORCA_USER_DATA_PATH', userData)
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
  const selected =
    lane === 'system'
      ? null
      : lane === 'mirror'
        ? join(userData, 'codex-runtime-home', 'home')
        : lane === 'wsl'
          ? '\\\\wsl.localhost\\Ubuntu\\home\\u\\account'
          : join(userData, 'codex-accounts', 'acct', 'home')
  await assemblePtySpawnLaunchOptions({
    args: { cols: 80, rows: 24, launchAgent: 'codex' },
    env: { HOME: mocks.user },
    envToDelete: [],
    launchCommand: 'codex',
    cwd: join(root, 'repository'),
    isDaemonHostSpawn: false,
    preAdoptedStablePane: false,
    isNewSession: true,
    codexRuntime: lane === 'wsl' ? 'wsl' : 'host',
    expectedWslDistro: lane === 'wsl' ? 'Ubuntu' : null,
    requestedAgentTeamsPath: undefined,
    selectedCodexHomePath: selected,
    shellOverride: undefined,
    paneKey: null,
    sessionId: undefined,
    spawnIntent: undefined,
    store: undefined,
    claudeAuth: null,
    getSettings: () => getDefaultSettings(mocks.user)
  })
  expect(mocks.trust).toHaveBeenLastCalledWith(
    expect.objectContaining({ codexAccountHomePath: trusted ? selected : null })
  )
})
