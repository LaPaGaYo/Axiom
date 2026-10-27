import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

/** Synthetic account only; live apps must apply the returned settings through updateSettings. */
export function seedCodexTestAccount(
  userData: string,
  options: { accountId?: string; persistSettings?: boolean } = {}
) {
  const accountId = options.accountId ?? 'e2e-codex'
  if (!/^[a-zA-Z0-9_-]+$/.test(accountId)) {
    throw new Error('Invalid test account id')
  }
  const homePath = join(userData, 'codex-accounts', accountId, 'home')
  mkdirSync(homePath, { recursive: true })
  writeFileSync(join(homePath, '.orca-managed-home'), `${accountId}\n`)
  // Exclusive creation: never overwrite or import an existing login.
  writeFileSync(
    join(homePath, 'auth.json'),
    JSON.stringify({ OPENAI_API_KEY: 'e2e-placeholder' }),
    { flag: 'wx', mode: 0o600 }
  )
  const settings = {
    codexManagedAccounts: [
      {
        id: accountId,
        email: 'codex-test@example.invalid',
        managedHomePath: homePath,
        managedHomeRuntime: 'host' as const,
        createdAt: 1,
        updatedAt: 1,
        lastAuthenticatedAt: 1
      }
    ],
    activeCodexManagedAccountId: accountId,
    activeCodexManagedAccountIdsByRuntime: { host: accountId, wsl: {} }
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
