import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type * as NodeOs from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDefaultSettings } from '../../shared/constants'
import { snapshotAccountTestHome } from '../codex/codex-account-home-layout.test-support'

const testState = vi.hoisted(() => ({ fakeHomeDir: '' }))

vi.mock('electron', () => ({
  app: {
    getPath: () => {
      throw new Error('tests pass explicit homes')
    }
  }
}))

vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof NodeOs>('node:os')
  return { ...actual, homedir: () => testState.fakeHomeDir }
})

import { CodexConfigMirror } from './codex-config-mirror'

const OVERRIDE_LINE = 'daemon_auto_start = false # orca: CODEX_HOME too long for the daemon socket'

describe('CodexConfigMirror without ~/.codex/config.toml', () => {
  let root: string
  let managedHomePath: string
  let mirror: CodexConfigMirror

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'orca-codex-accounts-mirror-'))
    testState.fakeHomeDir = join(root, 'user-home')
    mkdirSync(testState.fakeHomeDir)
    // Long enough to exceed sun_path on every platform, like a real account home.
    managedHomePath = join(root, 'a'.repeat(80), 'home')
    mkdirSync(managedHomePath, { recursive: true })
    const settings = {
      ...getDefaultSettings(testState.fakeHomeDir),
      codexManagedAccounts: [
        {
          id: 'acct',
          email: 'user@example.com',
          managedHomePath,
          createdAt: 1,
          updatedAt: 1,
          lastAuthenticatedAt: 1
        }
      ]
    }
    mirror = new CodexConfigMirror({ getSettings: () => settings }, (path) => path)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('still guards every managed home against the daemon socket limit', () => {
    mirror.safeSyncToManagedHomes()

    const config = readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')
    expect(config).toContain('Axiom (D83)')
    expect(config).toContain(OVERRIDE_LINE)
    expect(config).toContain('apps = false\nplugins = false')
    expect(existsSync(join(testState.fakeHomeDir, '.codex'))).toBe(false)
  })

  it('leaves a WSL home to launch prep instead of running its blocking ownership check', () => {
    const assertManagedHomePath = vi.fn((path: string) => path)
    const wslMirror = new CodexConfigMirror(
      { getSettings: () => getDefaultSettings(testState.fakeHomeDir) },
      assertManagedHomePath
    )

    wslMirror.safeSyncIntoManagedHome(
      '\\\\wsl.localhost\\Ubuntu\\home\\u\\.local\\share\\orca\\codex-accounts\\acct\\home',
      undefined,
      'acct'
    )

    expect(assertManagedHomePath).not.toHaveBeenCalled()
  })

  it('replaces runtime settings with the account layout and daemon guard', () => {
    writeFileSync(join(managedHomePath, 'config.toml'), 'model = "gpt-5"\n')

    mirror.safeSyncIntoManagedHome(managedHomePath, undefined, 'acct')

    const config = readFileSync(join(managedHomePath, 'config.toml'), 'utf-8')
    expect(config).not.toContain('model =')
    expect(config).toContain(OVERRIDE_LINE)
  })

  it('reads the current allowlist on each lifecycle pass and retains the ownership check', () => {
    const systemHome = join(testState.fakeHomeDir, '.codex')
    mkdirSync(systemHome)
    writeFileSync(join(systemHome, 'config.toml'), '[mcp_servers.docs]\ncommand = "docs"\n')
    const settings = getDefaultSettings(testState.fakeHomeDir)
    const assertHome = vi.fn((home: string) => home)
    const currentMirror = new CodexConfigMirror({ getSettings: () => settings }, assertHome)
    const before = snapshotAccountTestHome(systemHome)
    currentMirror.safeSyncIntoManagedHome(managedHomePath, undefined, 'acct')
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf8')).not.toContain('mcp_servers')
    settings.codexAccountHomeAllowlist.mcpServers = ['docs']
    currentMirror.safeSyncIntoManagedHome(managedHomePath, undefined, 'acct')
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf8')).toContain(
      '[mcp_servers.docs]'
    )
    settings.codexAccountHomeAllowlist.mcpServers = []
    currentMirror.safeSyncIntoManagedHome(managedHomePath, undefined, 'acct')
    expect(readFileSync(join(managedHomePath, 'config.toml'), 'utf8')).not.toContain('mcp_servers')
    expect(snapshotAccountTestHome(systemHome)).toEqual(before)
    expect(assertHome).toHaveBeenCalledTimes(3)
    expect(assertHome).toHaveBeenLastCalledWith(managedHomePath, 'acct')
  })
})
