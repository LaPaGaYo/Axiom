import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { layoutCodexAccountHome, type CodexAccountHomeManifest } from './codex-account-home-layout'
import { CodexAccountRequiredError, usesCodexAccountHomeLayout } from './codex-home-paths'
import { readCodexLastRefresh } from '../codex-accounts/runtime-home-service-auth-sync-identity'
import {
  resolveCodexHomeProcessLockKey,
  withCodexHomeProcessLock
} from '../codex-cli/codex-home-process-lock'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import { runCodexAppServerSession } from './codex-app-server-session'
import { resolveCodexStructuredInvocation } from './codex-structured-launch-resolution'

type Token = 'not_applicable' | 'fresh' | 'refreshed' | 'refresh_failed'
export type CodexWorkerLaunchHome =
  | { kind: 'unmanaged'; homePath: string | null }
  | { kind: 'account'; homePath: string; manifest: CodexAccountHomeManifest; token: Token }

// RuntimeStore exposes only a subset of GlobalSettings; validate this launch setting at the seam.
export function readCodexAccountHomeAllowlist(settings: unknown) {
  return (
    z
      .object({
        codexAccountHomeAllowlist: z
          .object({
            skills: z.array(z.string()),
            mcpServers: z.array(z.string())
          })
          .nullish()
      })
      .parse(settings).codexAccountHomeAllowlist ?? { skills: [], mcpServers: [] }
  )
}

export async function prepareCodexWorkerLaunchHome(input: {
  resolveHome: () => string | null
  allowlist: { skills: string[]; mcpServers: string[] }
  userHomePath?: string
  now?: () => number
  refreshToken?: (homePath: string) => Promise<void>
}): Promise<CodexWorkerLaunchHome> {
  const homePath = input.resolveHome()
  if (homePath === null || !usesCodexAccountHomeLayout(homePath)) {
    // D83 ruling ①: only Windows/WSL retain unmanaged launches.
    if (process.platform !== 'win32') {
      throw new CodexAccountRequiredError()
    }
    return { kind: 'unmanaged', homePath }
  }
  const manifest = layoutCodexAccountHome({ ...input, homePath })
  const token = await checkToken(
    homePath,
    input.now ?? Date.now,
    input.refreshToken ?? refreshToken
  )
  return { kind: 'account', homePath, manifest, token }
}

const Auth = z.object({ tokens: z.record(z.string(), z.unknown()).nullish() })
async function readTokenStatus(homePath: string) {
  const contents = await readFile(join(homePath, 'auth.json'), 'utf8')
  const auth = Auth.parse(JSON.parse(contents))
  return { applicable: !!auth.tokens, lastRefresh: readCodexLastRefresh(contents) }
}

async function checkToken(
  homePath: string,
  now: () => number,
  refresh: (homePath: string) => Promise<void>
): Promise<Token> {
  const status = (auth: Awaited<ReturnType<typeof readTokenStatus>>) =>
    !auth.applicable
      ? ('not_applicable' as const)
      : auth.lastRefresh !== null && auth.lastRefresh > now() - 7 * 86_400_000
        ? ('fresh' as const)
        : null
  try {
    const initial = status(await readTokenStatus(homePath))
    if (initial) {
      return initial
    }
    return await withCodexHomeProcessLock(resolveCodexHomeProcessLockKey(homePath), async () => {
      const before = await readTokenStatus(homePath)
      const current = status(before)
      if (current) {
        return current
      }
      await refresh(homePath)
      const after = await readTokenStatus(homePath)
      return after.lastRefresh !== null &&
        (before.lastRefresh === null || after.lastRefresh > before.lastRefresh)
        ? 'refreshed'
        : 'refresh_failed'
    })
  } catch {
    // D68 classifies a later authentication failure; credential bytes/errors never leave here.
    return 'refresh_failed'
  }
}

async function refreshToken(homePath: string): Promise<void> {
  const { command } = await resolveCodexStructuredInvocation({})
  await runCodexAppServerSession(
    {
      command,
      cliPath: command,
      args: [...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
      env: { CODEX_HOME: homePath },
      timeoutMs: 10_000
    },
    (rpc) => rpc.request('account/read', { refreshToken: true })
  )
}
