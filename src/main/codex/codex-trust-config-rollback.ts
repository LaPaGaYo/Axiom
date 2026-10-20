import {
  chmodSync,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { renameFileWithWindowsRetry } from '../codex-accounts/fs-utils'
import { isDefinitiveAbsence } from '../../shared/definitive-filesystem-absence'

export type CodexTrustConfigSnapshot = (
  | { existed: false; restorePath?: string }
  | { existed: true; contents: Buffer; mode: number; restorePath: string }
) & { generation?: Buffer | null }

function readGeneration(restorePath: string): Buffer | null {
  try {
    return readFileSync(restorePath)
  } catch (error) {
    if (isDefinitiveAbsence(error)) {
      return null
    }
    throw error
  }
}

/** Pin the successful rebase before a later managed-grant session can edit it. */
export function recordCodexTrustConfigGeneration(
  tomlPath: string,
  snapshot: CodexTrustConfigSnapshot
): void {
  snapshot.generation = readGeneration(snapshot.restorePath ?? tomlPath)
}

function resolveConfigRestorePath(tomlPath: string): string {
  try {
    if (!lstatSync(tomlPath).isSymbolicLink()) {
      return tomlPath
    }
    try {
      return realpathSync.native(tomlPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
      // Why: a dangling dotfiles link is still user-owned state. Target the
      // lexical destination so rollback removes an RPC-created file, not the link.
      return resolve(dirname(tomlPath), readlinkSync(tomlPath))
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return tomlPath
    }
    throw error
  }
}

export function captureCodexTrustConfig(tomlPath: string): CodexTrustConfigSnapshot {
  const restorePath = resolveConfigRestorePath(tomlPath)
  let descriptor: number
  try {
    descriptor = openSync(restorePath, 'r')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return restorePath === tomlPath ? { existed: false } : { existed: false, restorePath }
    }
    throw error
  }
  try {
    // Why: read and stat the same open file so replacement between two path
    // lookups cannot pair one file's contents with another file's mode.
    return {
      existed: true,
      contents: readFileSync(descriptor),
      mode: fstatSync(descriptor).mode,
      restorePath
    }
  } finally {
    closeSync(descriptor)
  }
}

export function restoreCodexTrustConfig(
  tomlPath: string,
  snapshot: CodexTrustConfigSnapshot
): void {
  const restorePath = snapshot.restorePath ?? tomlPath
  // Why: Codex's failed RPC may have written bytes Orca never observed.
  // Without a known rebase generation, compare against its settled file.
  const generation =
    snapshot.generation === undefined ? readGeneration(restorePath) : snapshot.generation
  const current = readGeneration(restorePath)
  if (generation === null ? current !== null : current === null || !current.equals(generation)) {
    console.warn(
      '[codex-trust-config] config.toml changed during the trust session; leaving it as found',
      { path: tomlPath }
    )
    return
  }
  if (!snapshot.existed) {
    try {
      unlinkSync(snapshot.restorePath ?? tomlPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
    return
  }
  if (current?.equals(snapshot.contents)) {
    // Why: the RPC may change permissions without changing bytes; rollback
    // restores the complete captured file state, not only its contents.
    chmodSync(restorePath, snapshot.mode)
    return
  }
  // Why: rollback protects config integrity too; direct truncating writes can
  // leave Codex unusable if Orca exits midway through recovery.
  // Why: Codex's writer preserves config.toml symlinks. Restore through their
  // real target too, or Orca's atomic rename would disconnect dotfiles users.
  const tempPath = `${restorePath}.${process.pid}.${randomUUID()}.rollback.tmp`
  try {
    writeFileSync(tempPath, snapshot.contents, { mode: snapshot.mode })
    renameFileWithWindowsRetry(tempPath, restorePath)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // Best effort; preserve the rollback failure as the actionable error.
    }
    throw error
  }
}
