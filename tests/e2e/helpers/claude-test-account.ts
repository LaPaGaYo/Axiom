import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { z } from 'zod'

/** Synthetic host selection only: no login, credential file, or Keychain item is created. */
export function seedClaudeTestAccount(
  userData: string,
  options: { accountId?: string; persistSettings?: boolean } = {}
) {
  const accountId = options.accountId ?? 'e2e-claude'
  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    throw new Error('Invalid test account id')
  }
  const homePath = join(userData, 'claude-profiles', accountId, 'home')
  mkdirSync(homePath, { recursive: true, mode: 0o700 })
  writeFileSync(
    join(dirname(homePath), 'profile.json'),
    JSON.stringify({ version: 1, accountId, runtime: 'host' }),
    { flag: 'wx', mode: 0o600 }
  )
  const settings = {
    claudeManagedAccounts: [
      {
        id: accountId,
        email: 'claude-test@example.invalid',
        managedAuthPath: join(homePath, '.claude.json'),
        managedAuthRuntime: 'host' as const,
        authMethod: 'unknown' as const,
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      }
    ],
    activeClaudeManagedAccountId: accountId,
    activeClaudeManagedAccountIdsByRuntime: { host: accountId, wsl: {} }
  }
  if (options.persistSettings !== false) {
    const file = join(userData, 'orca-data.json')
    const previous = z
      .object({ settings: z.record(z.string(), z.unknown()).optional() })
      .passthrough()
      .parse(existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {})
    writeFileSync(
      file,
      JSON.stringify({ ...previous, settings: { ...previous.settings, ...settings } })
    )
  }
  return { accountId, homePath, settings }
}
