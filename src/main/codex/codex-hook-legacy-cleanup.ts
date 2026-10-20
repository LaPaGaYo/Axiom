import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  hookDefinitionHasManagedCommand,
  readHooksJsonWithRaw,
  removeManagedCommands,
  writeHooksJson
} from '../agent-hooks/installer-utils'
import { resolveHooksJsonWritePath } from '../agent-hooks/hook-config-write-path'
import { findManagedTomlBlocks } from '../agent-hooks/managed-toml-ownership'
import { writeConfigAtomically, type CodexTrustEntry } from './config-toml-trust'
import {
  getConfigPath,
  getSystemCodexConfigTomlPath,
  getSystemConfigPath
} from './codex-hook-definition'
import { isRetiredCodexHookCommand } from './codex-hook-retired-commands'
import { getSystemCodexHomePath } from './codex-home-paths'
import {
  collectManagedTrustEntries,
  removeSelfComputedMatchingTrustEntries
} from './codex-hook-trust-cleanup'
import { restoreRealHomeHooksJson } from './codex-real-home-hooks-json'
import { runExclusivelyForCodexTrustConfig } from './codex-trust-config-mutation-queue'
import { mutateRealHomeHooksPreservingUserTrust } from './codex-user-hook-trust-rebase'

const LEGACY_ORCA_PROFILE_NAME = 'orca-agent-status'
const LEGACY_ORCA_PROFILE_BLOCK_START = '# BEGIN ORCA AGENT STATUS HOOKS'
const LEGACY_ORCA_PROFILE_BLOCK_END = '# END ORCA AGENT STATUS HOOKS'

// Why: retain the host's existing real-home ownership gate. Even without it,
// this sweep removes only retired forms, never another instance's live entry.
let systemCodexHomeHookSweepSuppressed: () => boolean = () => false

export function setSystemCodexHomeHookSweepSuppressed(gate: () => boolean): void {
  systemCodexHomeHookSweepSuppressed = gate
}

function getLegacyCodexProfileTomlPath(): string {
  return join(getSystemCodexHomePath(), `${LEGACY_ORCA_PROFILE_NAME}.config.toml`)
}

export function cleanupLegacySystemManagedHooks(): Promise<void> {
  // Why: shares the real-home lane with ensureRealHomeCodexHookState — both
  // capture, mutate and roll back the user's ~/.codex/config.toml.
  return runExclusivelyForCodexTrustConfig(
    getSystemCodexConfigTomlPath(),
    sweepLegacySystemManagedHooks
  )
}

/** Automatic launch prep removes only retired forms and their proven trust.
 * The shared entry and grant ledger belong to explicit user opt-out. */
async function sweepLegacySystemManagedHooks(): Promise<void> {
  if (systemCodexHomeHookSweepSuppressed()) {
    return
  }
  const legacyConfigPath = getSystemConfigPath()
  const runtimeConfigPath = getConfigPath()
  if (legacyConfigPath === runtimeConfigPath) {
    return
  }

  const systemHomePath = getSystemCodexHomePath()
  // Why: the pre-write guard below compares against these bytes; a separate
  // later read would let a concurrent save land between parse and snapshot.
  const { raw: previousRaw, config } = readHooksJsonWithRaw(legacyConfigPath)
  if (!config?.hooks || previousRaw === null) {
    return
  }

  const nextHooks = { ...config.hooks }
  const trustEntries: CodexTrustEntry[] = []
  let removedManagedHook = false
  for (const [eventName, definitions] of Object.entries(nextHooks)) {
    if (!Array.isArray(definitions)) {
      continue
    }
    const eventTrustEntries = collectManagedTrustEntries(
      legacyConfigPath,
      eventName,
      definitions,
      isRetiredCodexHookCommand
    )
    // Why: user hook configs can be large; avoid the argument limit from push(...entries).
    for (const entry of eventTrustEntries) {
      trustEntries.push(entry)
    }
    const cleaned = removeManagedCommands(definitions, isRetiredCodexHookCommand)
    removedManagedHook ||= definitions.some((definition) =>
      hookDefinitionHasManagedCommand(definition, isRetiredCodexHookCommand)
    )
    if (cleaned.length === 0) {
      delete nextHooks[eventName]
    } else {
      nextHooks[eventName] = cleaned
    }
  }

  // Why: #2350 moved hooks to managed CODEX_HOME; remove only retired forms.
  if (removedManagedHook) {
    // Why: this is the user's system hooks file, not Orca's runtime copy.
    // Remove only stale Orca hook entries and preserve other managers' metadata.
    const hooksWritePath = resolveHooksJsonWritePath(legacyConfigPath)
    const previousMode = statSync(hooksWritePath).mode
    const generation = `${JSON.stringify({ ...config, hooks: nextHooks }, null, 2)}\n`
    await mutateRealHomeHooksPreservingUserTrust({
      sourcePath: legacyConfigPath,
      runtimeHomePath: systemHomePath,
      tomlPath: getSystemCodexConfigTomlPath(),
      beforeHooks: config.hooks,
      afterHooks: nextHooks,
      writeHooks: () => {
        if (
          readFileSync(legacyConfigPath, 'utf-8') !== previousRaw ||
          resolveHooksJsonWritePath(legacyConfigPath) !== hooksWritePath
        ) {
          // Why: the pre-mutation RPC may overlap a user save; downgrade must
          // never replace that newer dotfiles generation with our stale parse.
          throw new Error('System Codex hooks changed during trust repair')
        }
        writeHooksJson(
          hooksWritePath,
          { ...config, hooks: nextHooks },
          {
            preserveMode: true,
            serialized: generation
          }
        )
      },
      restoreHooks: () =>
        restoreRealHomeHooksJson(hooksWritePath, previousRaw, previousMode, generation)
    })
    // Why: stale dev/version entries can reference an older managed script
    // path that is not represented by the current grant ledger.
    removeSelfComputedMatchingTrustEntries(getSystemCodexConfigTomlPath(), trustEntries)
  }
}

export function stripLegacyManagedProfileBlock(content: string): string {
  const regions = findManagedTomlBlocks(content, {
    startMarker: LEGACY_ORCA_PROFILE_BLOCK_START,
    endMarker: LEGACY_ORCA_PROFILE_BLOCK_END
  })
  // A stray marker above a complete block must not hide it: take the first
  // terminated region and leave the orphan (and the user text around it) alone.
  const region = regions.find((candidate) => candidate.terminated) ?? regions[0]
  if (!region) {
    return content
  }
  if (!region.terminated) {
    // #18861: deleting to EOF took user text appended below the block. This
    // legacy body's shape is not knowable from current source, so there is
    // nothing to recognize it by; leave the whole thing alone. The stale profile
    // is inert (runtime CODEX_HOME supersedes it), so that costs nothing next to
    // destroying the user's trust entries.
    return content
  }
  // Rejoin with the file's own terminator; a bare \n seam here left Windows
  // configs with mixed endings.
  const eol = content.includes('\r\n') ? '\r\n' : '\n'
  const before = content.slice(0, region.markerOffset).replace(/[ \t]*(?:\r?\n)*$/, '')
  const after = content.slice(region.endOffset).replace(/^(?:\r?\n)+/, '')
  if (!before) {
    return after
  }
  if (!after) {
    return before.endsWith('\n') ? before : `${before}${eol}`
  }
  return `${before}${eol}${eol}${after}`
}

function cleanupLegacyCodexProfileHooks(): void {
  const profilePath = getLegacyCodexProfileTomlPath()
  if (!existsSync(profilePath)) {
    return
  }

  const existing = readFileSync(profilePath, 'utf-8')
  const next = stripLegacyManagedProfileBlock(existing)
  if (next === existing) {
    return
  }
  // Why: #2778 wrote Orca hooks into a Codex profile file; runtime CODEX_HOME supersedes it, so remove only Orca's marked block.
  if (next.trim().length === 0) {
    unlinkSync(profilePath)
  } else {
    writeConfigAtomically(profilePath, next)
  }
}

export async function cleanupLegacyManagedHookRepresentations(): Promise<void> {
  try {
    await cleanupLegacySystemManagedHooks()
    cleanupLegacyCodexProfileHooks()
  } catch (error) {
    console.warn('[codex-hook-service] failed to clean legacy Codex hooks', error)
  }
}
