import { lstatSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  createManagedCommandMatcher,
  readHooksJsonWithRaw,
  removeManagedCommands
} from '../agent-hooks/installer-utils'
import { writeFileAtomicallyIfUnchanged } from '../codex-accounts/fs-utils'
import { resolveHostCodexManagedHomeVerdict } from '../codex-accounts/host-codex-managed-home-ownership'
import { getCodexManagedScriptFileName } from './codex-hook-identity'
import type { GlobalSettings } from '../../shared/global-settings-types'

/** D83 ruling ①: the only remaining macOS/Linux write to the user's Codex home. */
export function retireCodexRealHome(input: {
  userHome: string
  userData: string
  store: {
    getSettings(): Pick<GlobalSettings, 'codexRealHomeCleanupDone'> & {
      codexManagedAccounts: {
        id: string
        managedHomePath: string
        managedHomeRuntime?: 'host' | 'wsl'
      }[]
    }
    updateSettings(settings: Pick<GlobalSettings, 'codexRealHomeCleanupDone'>): unknown
  }
  now?: () => Date
}): void {
  const settings = input.store.getSettings()
  if (process.platform === 'win32' || settings.codexRealHomeCleanupDone) {
    return
  }
  const system = join(input.userHome, '.codex')
  try {
    const hooks = removeHookEntries(system, input.userData, input.now ?? (() => new Date()))
    const sourceInodes = new Set<string>()
    walkFiles(join(system, 'sessions'), (_path, key) => sourceInodes.add(key))
    let unlinkedSessions = 0
    for (const account of settings.codexManagedAccounts) {
      if (account.managedHomeRuntime === 'wsl') {
        continue
      }
      const verdict = resolveHostCodexManagedHomeVerdict({
        candidatePath: account.managedHomePath,
        managedAccountsRoot: join(input.userData, 'codex-accounts'),
        systemCodexHomePath: system,
        expectedAccountId: account.id
      })
      if (verdict.kind !== 'owned') {
        continue
      }
      walkFiles(join(verdict.homePath, 'sessions'), (path, key) => {
        if (sourceInodes.has(key)) {
          unlinkSync(path)
          unlinkedSessions++
        }
      })
    }
    input.store.updateSettings({ codexRealHomeCleanupDone: true })
    console.info('[codex-real-home-retirement]', { hooks, unlinkedSessions })
  } catch {
    // A failed backup/write is not completion; retry next start without printing file contents.
    console.warn('[codex-real-home-retirement] cleanup incomplete; retrying next start')
  }
}

function removeHookEntries(system: string, userData: string, now: () => Date) {
  const path = join(system, 'hooks.json')
  try {
    if (!lstatSync(path).isFile()) {
      return 'nothing_to_do'
    }
  } catch {
    return 'nothing_to_do'
  }
  const { raw, config } = readHooksJsonWithRaw(path)
  if (raw === null || !config?.hooks) {
    return 'nothing_to_do'
  }
  // Same entry matcher as removeRealHomeCodexHookForOptOut; never touch approval tables.
  const matches = createManagedCommandMatcher(getCodexManagedScriptFileName())
  const hooks = { ...config.hooks }
  let changed = false
  for (const [event, definitions] of Object.entries(hooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const cleaned = removeManagedCommands(definitions, matches)
    if (
      cleaned.length === definitions.length &&
      cleaned.every((entry, i) => entry === definitions[i])
    ) {
      continue
    }
    changed = true
    if (cleaned.length) {
      hooks[event] = cleaned
    } else {
      delete hooks[event]
    }
  }
  if (!changed) {
    return 'nothing_to_do'
  }
  const backupDir = join(userData, 'codex-real-home-hooks')
  mkdirSync(backupDir, { recursive: true })
  writeFileSync(join(backupDir, `hooks-${now().toISOString().replaceAll(':', '-')}.json`), raw, {
    flag: 'wx',
    mode: 0o600
  })
  // Refuse a replacement/symlink after the backup; no hooks.json.bak in the user's home.
  if (
    !lstatSync(path).isFile() ||
    readFileSync(path, 'utf8') !== raw ||
    !writeFileAtomicallyIfUnchanged(
      path,
      raw,
      `${JSON.stringify({ ...config, hooks }, null, 2)}\n`,
      { mode: lstatSync(path).mode & 0o777 }
    )
  ) {
    throw new Error('hooks changed')
  }
  return 'removed'
}

function walkFiles(root: string, visit: (path: string, key: string) => void): void {
  let stat
  try {
    stat = lstatSync(root)
  } catch {
    return
  }
  if (stat.isFile()) {
    visit(root, `${stat.dev}:${stat.ino}`)
  } else if (stat.isDirectory()) {
    // Never follow directory symlinks, including sessions/ itself.
    for (const name of readdirSync(root)) {
      walkFiles(join(root, name), visit)
    }
  }
}
