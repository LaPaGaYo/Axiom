import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fingerprintCodex } from '../../codex/codex-hook-trust-derivation'
import { probeClaudeCliVersion } from '../../claude/claude-hook-event-versions'
import { withCliRuntimeOnPath } from '../../../shared/node-cli-command-resolution'
import { CLAUDE_LAUNCH_ENV } from './claude-launch-policy'

const versions = new Map<string, Promise<string | null>>()
export async function probeClaudeVersion(command: string): Promise<string | null> {
  const directory = await mkdtemp(join(tmpdir(), 'axiom-claude-version-'))
  try {
    const env = Object.fromEntries(
      Object.entries(
        withCliRuntimeOnPath(command, {
          ...process.env,
          ...CLAUDE_LAUNCH_ENV,
          CLAUDE_CONFIG_DIR: directory
        })
      ).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
    return await probeClaudeCliVersion(command, { cwd: directory, env, timeoutMs: 30_000 })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

export async function claudeWorkerVersion(command: string): Promise<string | null> {
  // The existing helper stamps any executable's real path, size, mtime and inode.
  const fingerprint = fingerprintCodex(command)
  if (!fingerprint) {
    return null
  }
  let version = versions.get(fingerprint)
  if (!version) {
    version = probeClaudeVersion(command).catch(() => null)
    versions.set(fingerprint, version)
  }
  return version
}
