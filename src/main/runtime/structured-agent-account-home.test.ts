import { afterEach, expect, it, vi } from 'vitest'
import { resolveStructuredCodexAccountHomePath } from './structured-agent-account-home'

vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  homedir: () => '/fixture/user'
}))
afterEach(() => vi.restoreAllMocks())

it.each(['darwin', 'linux'] as const)(
  '%s refuses missing account resolution despite ambient CODEX_HOME',
  async (platform) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue(platform)
    for (const resolveLaunchHome of [null, () => null]) {
      await expect(
        resolveStructuredCodexAccountHomePath({
          launchEnv: { CODEX_HOME: '/fixture/ambient' },
          resolveLaunchHome
        })
      ).rejects.toMatchObject({ code: 'no_account' })
    }
  }
)

it('keeps the Windows resolver fallback', async () => {
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
  await expect(
    resolveStructuredCodexAccountHomePath({
      launchEnv: { CODEX_HOME: '/fixture/ambient' },
      resolveLaunchHome: null
    })
  ).resolves.toBe('/fixture/ambient')
})
