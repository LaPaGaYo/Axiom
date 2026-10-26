import { MANAGED_HOOK_TIMEOUT_SECONDS } from '../agent-hooks/installer-utils'
import { computeOrcaCodexHookHashes } from './codex-hook-definition'
import { readEveryMemoizedCodexHookHashes } from './codex-hook-trust-memo'
import { readLedgerOrcaHashes } from './codex-managed-trust-reconciliation'
import type { CodexEventLabel } from './config-toml-trust'
import type { CodexHookHashes } from './codex-hook-trust-derivation'

/** Saved ownership evidence; account layout must not load the Codex process/probe lane. */
export function readSavedOrcaHashes(
  homePath: string,
  command: string,
  knownHashes: readonly CodexHookHashes[] = readEveryMemoizedCodexHookHashes()
): CodexHookHashes[] {
  return [
    computeOrcaCodexHookHashes(command),
    ...knownHashes,
    ...readLedgerOrcaHashes(homePath, command, MANAGED_HOOK_TIMEOUT_SECONDS)
  ]
}

/** The one rule for whether an approval's hash is Orca's. */
export function isKnownOrcaHash(
  knownOrcaHashes: readonly CodexHookHashes[],
  eventLabel: CodexEventLabel,
  trustedHash: string | undefined
): boolean {
  return (
    trustedHash !== undefined &&
    knownOrcaHashes.some((hashes) => hashes[eventLabel] === trustedHash)
  )
}
