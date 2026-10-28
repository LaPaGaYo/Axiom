import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { ClaudeProfileRouter, type ClaudeProfileRouterSettings } from './claude-profile-router'
import { claudeProfileMarkerPath } from './claude-profile-paths'
import { resolveClaudeStructuredLaunchHome } from '../claude/claude-structured-launch-home'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'claude-launch-refresh-'))
  roots.push(root)
  const settings: ClaudeProfileRouterSettings = {
    claudeManagedAccounts: [
      {
        id: 'a',
        email: 'a@example.test',
        authMethod: 'subscription-oauth',
        managedAuthPath: '/unused',
        createdAt: 0,
        updatedAt: 0,
        lastAuthenticatedAt: 0
      }
    ],
    activeClaudeManagedAccountId: 'a',
    agentStatusHooksEnabled: false,
    disabledTuiAgents: []
  }
  const setup = vi.fn<
    NonNullable<ConstructorParameters<typeof ClaudeProfileRouter>[0]['runSetup']>
  >(async ({ profile }) => {
    await mkdir(profile.home, { recursive: true })
    await writeFile(claudeProfileMarkerPath(profile), '{}')
    return { outcome: 'prepared', warnings: [], surfaces: {} }
  })
  const router = new ClaudeProfileRouter({
    getSettings: () => settings,
    dataRoot: root,
    userHome: join(root, 'personal'),
    env: {},
    runSetup: setup
  })
  const home = router.accountHome('a')
  return { router, home, setup }
}

it('skips refresh of a prepared home while still publishing the selected pointer', async () => {
  const { router, home, setup } = await fixture()
  await router.prepareAccount('a')
  setup.mockClear()
  await expect(router.prepareLaunch({ refresh: false })).resolves.toMatchObject({ configDir: home })
  expect(setup).not.toHaveBeenCalled()
  expect(await readFile(router.pointerPath, 'utf8')).toBe(home)
  await router.prepareLaunch()
  expect(setup).toHaveBeenCalledTimes(1)
})

it('preserves first setup even when refresh is disabled', async () => {
  const { router, home, setup } = await fixture()
  await expect(router.prepareLaunch({ refresh: false })).resolves.toMatchObject({ configDir: home })
  expect(setup).toHaveBeenCalledTimes(1)
})

it('passes the refresh option through launch-home resolution and keeps the home env pin', async () => {
  const { router, home, setup } = await fixture()
  await router.prepareAccount('a')
  setup.mockClear()
  const prepare = vi.spyOn(router, 'prepareLaunch')
  const env: Record<string, string> = {}
  await expect(
    resolveClaudeStructuredLaunchHome(router, env, '/old', { refresh: false })
  ).resolves.toBe(home)
  expect(prepare).toHaveBeenCalledWith({ refresh: false })
  expect(setup).not.toHaveBeenCalled()
  expect(env.CLAUDE_CONFIG_DIR).toBe(home)
  await resolveClaudeStructuredLaunchHome(router, env, '/old')
  expect(setup).toHaveBeenCalledTimes(1)
})
