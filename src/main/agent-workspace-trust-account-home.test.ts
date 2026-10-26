import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import type * as NodeOs from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { parse } from 'smol-toml'
import { layoutCodexAccountHome } from './codex/codex-account-home-layout'
import { snapshotAccountTestHome } from './codex/codex-account-home-layout.test-support'
import { applyAgentWorkspaceTrust } from './agent-workspace-trust'

const homes = vi.hoisted(() => ({ user: '' }))
vi.mock('node:os', async () => ({
  ...(await vi.importActual<typeof NodeOs>('node:os')),
  homedir: () => homes.user
}))
afterEach(() => vi.unstubAllEnvs())

it('writes launch trust only to the account and preserves it across the subsequent layout', async () => {
  const root = mkdtempSync(join(tmpdir(), 'axiom-account-trust-'))
  homes.user = join(root, 'user')
  const systemHomePath = join(homes.user, '.codex')
  const homePath = join(root, 'data', 'codex-accounts', 'acct', 'home')
  mkdirSync(systemHomePath, { recursive: true })
  mkdirSync(homePath, { recursive: true })
  vi.stubEnv('ORCA_USER_DATA_PATH', join(root, 'data'))
  writeFileSync(join(systemHomePath, 'config.toml'), 'model = "system"\n')
  const before = snapshotAccountTestHome(systemHomePath)
  const workspace = join(root, 'repository')
  await applyAgentWorkspaceTrust('codex', workspace, {
    env: { HOME: homes.user },
    claudeAuth: null,
    wslDistro: null,
    connectionId: null,
    codexAccountHomePath: homePath
  })
  layoutCodexAccountHome({
    homePath,
    systemHomePath,
    userHomePath: homes.user,
    allowlist: { skills: [], mcpServers: [] }
  })
  expect(parse(readFileSync(join(homePath, 'config.toml'), 'utf8')).projects).toEqual({
    [workspace]: { trust_level: 'trusted' }
  })
  expect(snapshotAccountTestHome(systemHomePath)).toEqual(before)
})
