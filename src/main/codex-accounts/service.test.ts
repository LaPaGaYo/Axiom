import { describe, expect, it, vi, beforeEach } from 'vitest'
import { installFakeAppEnvironment } from '../../../config/scripts/vitest-host-ports-setup'
import { mkdirSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createManagedHome,
  createRateLimits,
  createRuntimeHome,
  createSettings,
  createStore,
  registerCodexAccountsTestHomes,
  testState
} from './service-test-harness'
import { createCanonicalHookTrustFixture } from './service-hook-trust-test-fixtures'
import { snapshotAccountTestHome } from '../codex/codex-account-home-layout.test-support'

const ACCOUNT_CONFIG =
  '# Written by Axiom (D83). Edits are replaced at the next layout.\n\n[features]\napps = false\nplugins = false\n'

// Why: temp homes exceed sun_path on macOS but not on Linux; keep asserted config bytes host-independent.
vi.mock('../codex/codex-daemon-socket-path-guard', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  applyCodexDaemonSocketGuard: (config: string) => config
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => testState.userDataDir
  }
}))
beforeEach(() => installFakeAppEnvironment({ getPath: () => testState.userDataDir }))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os') // eslint-disable-line @typescript-eslint/consistent-type-imports -- vi.importActual requires inline import()
  return {
    ...actual,
    homedir: () => testState.fakeHomeDir
  }
})

describe('CodexAccountService config sync', () => {
  registerCodexAccountsTestHomes()

  it('lays out managed homes on startup without changing the system home', async () => {
    const canonicalConfigPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    const canonicalConfig = 'approval_policy = "never"\nsandbox_mode = "danger-full-access"\n'
    writeFileSync(canonicalConfigPath, canonicalConfig, 'utf-8')
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'approval_policy = "on-request"\n',
      '{"account":"managed"}\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeCodexManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const { CodexAccountService } = await import('./service')
    const before = snapshotAccountTestHome(join(testState.fakeHomeDir, '.codex'))
    new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)

    expect(snapshotAccountTestHome(join(testState.fakeHomeDir, '.codex'))).toEqual(before)
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')).toBe(ACCOUNT_CONFIG)
    expect(readFileSync(join(managedHomePath, 'auth.json'), 'utf-8')).toBe(
      '{"account":"managed"}\n'
    )
  })

  it('does not seed source-home hook trust into a self-contained account home', async () => {
    const fixture = await createCanonicalHookTrustFixture()
    const canonicalConfigPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    writeFileSync(canonicalConfigPath, fixture.config, 'utf-8')
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'approval_policy = "on-request"\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ]
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()
    const { readHookTrustEntries } = await import('../codex/config-toml-trust')
    const { readCodexTrustGrantLedgerHome } = await import('../codex/codex-trust-grant-ledger')

    const { CodexAccountService } = await import('./service')
    const service = new CodexAccountService(
      store as never,
      rateLimits as never,
      runtimeHome as never
    )
    const expectSanitizedManagedConfig = (): void => {
      const entries = readHookTrustEntries(join(managedHomePath, 'config.toml'))
      for (const key of fixture.orcaKeys) {
        expect(entries.has(key)).toBe(false)
      }
      // Account homes never inherit user-hook approvals from the system home.
      expect(entries.has(fixture.userKey)).toBe(false)
    }

    expectSanitizedManagedConfig()
    expect(readFileSync(canonicalConfigPath, 'utf-8')).toBe(fixture.config)
    expect(readCodexTrustGrantLedgerHome(join(testState.fakeHomeDir, '.codex'))).not.toBeNull()

    writeFileSync(join(managedHomePath, 'config.toml'), 'approval_policy = "untrusted"\n', 'utf-8')
    await service.selectAccount('account-1')

    expectSanitizedManagedConfig()
  })

  it('drops system model instructions and sandbox settings from account homes', async () => {
    const canonicalConfigPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    writeFileSync(
      canonicalConfigPath,
      'model_instructions_file = "instructions.md"\nsandbox_mode = "danger-full-access"\n',
      'utf-8'
    )
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'approval_policy = "on-request"\n',
      '{"account":"managed"}\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeCodexManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const { CodexAccountService } = await import('./service')
    new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)

    const managedConfig = readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')
    expect(managedConfig).toBe(ACCOUNT_CONFIG)
  })

  it('does not rewrite a managed config the previous layout already settled', async () => {
    const canonicalConfigPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    const { escapeTomlString } = await import('../codex/config-toml-trust')
    const userHookKey = `${join(testState.fakeHomeDir, '.codex', 'user-hooks.json')}:stop:0:0`
    const canonicalConfig = [
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      `[hooks.state."${escapeTomlString(userHookKey)}"]`,
      'trusted_hash = "sha256:user-owned"',
      ''
    ].join('\n')
    writeFileSync(canonicalConfigPath, canonicalConfig, 'utf-8')
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      canonicalConfig,
      '{"account":"managed"}\n'
    )
    const managedConfigPath = join(managedHomePath, 'config.toml')
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ],
      activeCodexManagedAccountId: 'account-1'
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const { CodexAccountService } = await import('./service')
    new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)

    // The first layout drops user-hook approvals; a later pass leaves its bytes and mtime intact.
    const settledConfig = readFileSync(managedConfigPath, 'utf-8')
    const oldDate = new Date('2024-01-01T00:00:00.000Z')
    utimesSync(managedConfigPath, oldDate, oldDate)

    new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)

    expect(readFileSync(managedConfigPath, 'utf-8')).toBe(settledConfig)
    expect(statSync(managedConfigPath).mtimeMs).toBe(oldDate.getTime())
  })

  it('lays out account configs even when the system config is missing', async () => {
    const firstManagedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'sandbox_mode = "danger-full-access"\n',
      '{"account":"one"}\n'
    )
    const secondManagedHomePath = createManagedHome(
      testState.userDataDir,
      'account-2',
      'sandbox_mode = "workspace-write"\n',
      '{"account":"two"}\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'one@example.com',
          managedHomePath: firstManagedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        },
        {
          id: 'account-2',
          email: 'two@example.com',
          managedHomePath: secondManagedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 2,
          updatedAt: 2,
          lastAuthenticatedAt: 2
        }
      ]
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const { CodexAccountService } = await import('./service')
    new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)

    expect(readFileSync(join(firstManagedHomePath, 'config.toml'), 'utf-8')).toBe(ACCOUNT_CONFIG)
    expect(readFileSync(join(secondManagedHomePath, 'config.toml'), 'utf-8')).toBe(ACCOUNT_CONFIG)
  })

  it('re-syncs config when selecting an account', async () => {
    const canonicalConfigPath = join(testState.fakeHomeDir, '.codex', 'config.toml')
    writeFileSync(canonicalConfigPath, 'sandbox_mode = "danger-full-access"\n', 'utf-8')
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'approval_policy = "on-request"\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ]
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const { CodexAccountService } = await import('./service')
    const service = new CodexAccountService(
      store as never,
      rateLimits as never,
      runtimeHome as never
    )

    writeFileSync(join(managedHomePath, 'config.toml'), 'approval_policy = "untrusted"\n', 'utf-8')

    const before = snapshotAccountTestHome(join(testState.fakeHomeDir, '.codex'))
    await service.selectAccount('account-1')

    expect(snapshotAccountTestHome(join(testState.fakeHomeDir, '.codex'))).toEqual(before)
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')).toBe(ACCOUNT_CONFIG)
    expect(rateLimits.refreshForCodexAccountChange).toHaveBeenCalledTimes(1)
    expect(runtimeHome.syncForCurrentSelection).toHaveBeenCalledTimes(1)
  })

  it('does not throw on startup when the canonical config path is unreadable', async () => {
    mkdirSync(join(testState.fakeHomeDir, '.codex', 'config.toml'), { recursive: true })
    const managedHomePath = createManagedHome(
      testState.userDataDir,
      'account-1',
      'approval_policy = "on-request"\n'
    )
    const settings = createSettings({
      codexManagedAccounts: [
        {
          id: 'account-1',
          email: 'user@example.com',
          managedHomePath,
          providerAccountId: null,
          workspaceLabel: null,
          workspaceAccountId: null,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ]
    })
    const store = createStore(settings)
    const rateLimits = createRateLimits()
    const runtimeHome = createRuntimeHome()

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { CodexAccountService } = await import('./service')

    expect(
      () => new CodexAccountService(store as never, rateLimits as never, runtimeHome as never)
    ).not.toThrow()
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')).toBe(ACCOUNT_CONFIG)
    expect(warnSpy).not.toHaveBeenCalled()
  })
})
