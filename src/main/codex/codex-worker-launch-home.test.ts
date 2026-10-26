import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import * as paths from './codex-home-paths'
import * as session from './codex-app-server-session'
import * as invocation from './codex-structured-launch-resolution'
import { CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS } from '../codex-cli/codex-read-only-app-server-args'
import {
  withCodexHomeProcessLock,
  resolveCodexHomeProcessLockKey
} from '../codex-cli/codex-home-process-lock'
import { ManagedCodexHomeTemporarilyUnavailableError } from '../codex-accounts/host-codex-managed-home-ownership'
import { prepareCodexWorkerLaunchHome } from './codex-worker-launch-home'

const now = Date.parse('2026-10-25T12:00:00Z')
const day = 86_400_000
let root: string
let homePath: string
let userHomePath: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'axiom-worker-home-'))
  homePath = join(root, 'codex-accounts', 'account', 'home')
  userHomePath = join(root, 'user')
  await mkdir(homePath, { recursive: true })
  vi.stubEnv('ORCA_USER_DATA_PATH', root)
  vi.spyOn(paths, 'getSystemCodexHomePath').mockReturnValue(join(userHomePath, '.codex'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  await rm(root, { recursive: true, force: true })
})
const input = () => ({
  resolveHome: () => homePath,
  allowlist: { skills: [], mcpServers: [] },
  userHomePath,
  now: () => now
})
const auth = (lastRefresh?: number) =>
  writeFile(
    join(homePath, 'auth.json'),
    JSON.stringify({
      tokens: { refresh_token: 'synthetic-private-value' },
      ...(lastRefresh === undefined ? {} : { last_refresh: new Date(lastRefresh).toISOString() })
    })
  )
it.each(['null', 'mirror'] as const)('leaves %s homes unmanaged', async (lane) => {
  const home = lane === 'null' ? null : paths.resolveOrcaManagedCodexHomePath()
  expect(await prepareCodexWorkerLaunchHome({ ...input(), resolveHome: () => home })).toEqual({
    kind: 'unmanaged',
    homePath: home
  })
})
it.each([
  ['api', 'not_applicable'],
  ['fresh', 'fresh'],
  ['stale', 'refreshed'],
  ['boundary', 'refreshed'],
  ['missing_timestamp', 'refreshed'],
  ['error', 'refresh_failed'],
  ['unchanged', 'refresh_failed'],
  ['unreadable', 'refresh_failed']
] as const)('prepares an account manifest with %s token status', async (mode, token) => {
  if (mode === 'api') {
    await writeFile(
      join(homePath, 'auth.json'),
      JSON.stringify({ OPENAI_API_KEY: 'synthetic-private-value' })
    )
  } else if (mode !== 'unreadable') {
    await auth(
      mode === 'missing_timestamp'
        ? undefined
        : now - (mode === 'fresh' ? 6 : mode === 'boundary' ? 7 : 9) * day
    )
  }
  const refreshToken = vi.fn(async () => {
    if (mode === 'error') {
      throw new Error('synthetic-private-value')
    }
    if (mode !== 'unchanged') {
      await auth(now)
    }
  })
  const result = await prepareCodexWorkerLaunchHome({ ...input(), refreshToken })
  expect(result).toMatchObject({
    kind: 'account',
    homePath,
    token,
    manifest: { configSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }
  })
  expect(refreshToken).toHaveBeenCalledTimes(['api', 'fresh', 'unreadable'].includes(mode) ? 0 : 1)
  expect(JSON.stringify(result)).not.toMatch(
    /synthetic-private-value|refresh_token|OPENAI_API_KEY|last_refresh/
  )
})
it('serializes stale launches with the existing lock and rechecks after waiting', async () => {
  await auth(now - 9 * day)
  let unblock = () => {}
  const blocked = new Promise<void>((resolve) => {
    unblock = resolve
  })
  const held = withCodexHomeProcessLock(resolveCodexHomeProcessLockKey(homePath), () => blocked)
  const refreshToken = vi.fn(async () => {
    await auth(now)
  })
  const launches = Promise.all(
    [1, 2].map(() => prepareCodexWorkerLaunchHome({ ...input(), refreshToken }))
  )
  await Promise.resolve()
  expect(refreshToken).not.toHaveBeenCalled()
  unblock()
  await held
  expect((await launches).map((result) => result.kind === 'account' && result.token)).toEqual([
    'refreshed',
    'fresh'
  ])
  expect(refreshToken).toHaveBeenCalledExactlyOnceWith(homePath)
})
it('uses one short-lived app-server refresh in the selected home by default', async () => {
  await auth(now - 9 * day)
  vi.spyOn(invocation, 'resolveCodexStructuredInvocation').mockResolvedValue({
    command: '/fake/codex',
    environment: undefined
  })
  const request = vi.fn(async () => {
    await auth(now)
  })
  const run = vi
    .spyOn(session, 'runCodexAppServerSession')
    .mockImplementation(async (_launch, consume) => consume({ request, notify: vi.fn() }))
  expect(await prepareCodexWorkerLaunchHome(input())).toMatchObject({ token: 'refreshed' })
  expect(run).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      command: '/fake/codex',
      cliPath: '/fake/codex',
      args: [...CODEX_SHORT_LIVED_PROBE_APP_SERVER_ARGS],
      env: { CODEX_HOME: homePath }
    }),
    expect.any(Function)
  )
  expect(request).toHaveBeenCalledWith('account/read', { refreshToken: true })
})
it('propagates resolver and layout refusals before refresh', async () => {
  const refusal = new ManagedCodexHomeTemporarilyUnavailableError()
  await expect(
    prepareCodexWorkerLaunchHome({
      ...input(),
      resolveHome: () => {
        throw refusal
      }
    })
  ).rejects.toBe(refusal)
  await mkdir(join(homePath, 'config.toml'))
  const refreshToken = vi.fn()
  await expect(prepareCodexWorkerLaunchHome({ ...input(), refreshToken })).rejects.toThrow(
    /non-regular/
  )
  expect(refreshToken).not.toHaveBeenCalled()
})
