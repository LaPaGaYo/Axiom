import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AgentSessionRecord } from '../../shared/agent-session-record'
import { agentSessionRecordFixture } from '../../shared/agent-session-record.test-fixture'
import { createClaudeStructuredLaunchResolver } from '../runtime/structured-agent-launch-composition.test-support'
import { registerClaudeMissionSessionPins } from './claude-mission-session-pins'
import * as launchHome from './claude-structured-launch-home'
import { claudeStructuredSpawnOptions } from './claude-structured-spawn-options'
import {
  acquired,
  fakeClaude,
  identityFor,
  USER_MESSAGE
} from './claude-structured-session-test-support'

const launchEnv = { DISABLE_TELEMETRY: '1', CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1' }

const managedSettings = {
  disableAllHooks: true,
  permissions: { disableBypassPermissionsMode: 'disable' }
}

const cleanup: (() => void)[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
})

function resolve(sessionId: string) {
  const record: AgentSessionRecord = {
    ...agentSessionRecordFixture(),
    sessionId,
    provider: 'claude',
    location: {
      executionHostId: 'local',
      wslDistro: null,
      workspaceId: 'wt',
      workspaceKind: 'folder'
    },
    accountHome: { variable: 'CLAUDE_CONFIG_DIR', path: '/account/claude' },
    providerHandleChain: []
  }
  return createClaudeStructuredLaunchResolver({
    store: { getRecord: () => record, pinLaunchDirectory: vi.fn() },
    resolveCommand: () => '/usr/local/bin/claude',
    resolveInheritedEnv: async () => ({ PATH: '/usr/bin' }),
    resolveAuthPolicy: () => ({ account: 'managed' }),
    resolveEnv: () => Object.fromEntries(Object.keys(launchEnv).map((key) => [key, '0'])),
    resolveLaunchArgs: () => [
      '--settings',
      '/user/settings.json',
      '--plugin-dir',
      '/user/plugin',
      '--add-dir',
      '/user/outside',
      '--model',
      'user-model',
      '--effort',
      'low'
    ]
  })({ identity: identityFor(sessionId), permissionMode: 'full-access' })
}

function register(model?: string, accountHomePath = '/account/claude') {
  cleanup.push(
    registerClaudeMissionSessionPins('dispatch-pins', 'mission-planner', {
      settingsPath: '/attempt/planner-settings.json',
      env: launchEnv,
      managedSettings,
      skills: ['review'],
      effort: 'high',
      accountHomePath,
      ...(model ? { model } : {}),
      mcpServers: {
        axiom: {
          type: 'stdio',
          command: '/app/axiom',
          args: ['attempt', 'mcp'],
          env: { ORCA_AGENT_SESSION_ID: 'mission-planner' }
        }
      },
      denyPermission: () => {}
    })
  )
}

describe('Mission Claude Planner launch pins', () => {
  it('refuses a final home outside the managed account pinned by the Control Plane', async () => {
    register(undefined, '/managed/other-account')
    await expect(resolve('mission-planner')).rejects.toThrow('No Claude account selected')
  })
  it('owns permission mode, settings, skills and env over saved arguments and host overlay', async () => {
    register('policy-model')
    const home = vi.spyOn(launchHome, 'resolveClaudeStructuredLaunchHome')
    const launch = await resolve('mission-planner')
    expect(launch.options).toMatchObject({
      settingSources: [],
      managedSettings,
      skills: ['review'],
      permissionMode: 'default',
      mcpServers: {
        axiom: {
          type: 'stdio',
          command: '/app/axiom',
          args: ['attempt', 'mcp'],
          env: { ORCA_AGENT_SESSION_ID: 'mission-planner' }
        }
      },
      strictMcpConfig: true,
      settings: '/attempt/planner-settings.json',
      model: 'policy-model',
      effort: 'high'
    })
    expect(home).toHaveBeenCalledWith(undefined, expect.any(Object), '/account/claude', {
      refresh: false
    })
    expect(launch.options.extraArgs).toEqual({ 'replay-user-messages': null })
    expect(launch.options).not.toHaveProperty('plugins')
    expect(launch.options).not.toHaveProperty('additionalDirectories')
    expect(launch.env).toMatchObject(launchEnv)
  })

  it.each([undefined, 'policy-model'])(
    'saved model and fast mode cannot replace policy pins: %s',
    async (model) => {
      register(model)
      const launch = await resolve('mission-planner')
      const spawn = claudeStructuredSpawnOptions({
        launch,
        saved: { model: 'saved-model', effort: 'low', fastMode: 'false' }
      })
      expect(spawn.sdkOptions.settings).toBe('/attempt/planner-settings.json')
      expect(spawn.sdkOptions.model).toBe(model)
      expect(spawn.sdkOptions.effort).toBe('high')
      expect(spawn.options.get('fastMode')).toBeUndefined()
      expect(spawn.fastModeAtStart).toBe(false)
    }
  )

  it('keeps ordinary Claude session arguments, settings sources and saved model behavior', async () => {
    const home = vi.spyOn(launchHome, 'resolveClaudeStructuredLaunchHome')
    const launch = await resolve('ordinary')
    const spawn = claudeStructuredSpawnOptions({ launch, saved: { model: 'saved-model' } })
    expect(home).toHaveBeenCalledWith(undefined, expect.any(Object), '/account/claude', undefined)
    expect(launch.options.managedSettings).toBeUndefined()
    expect(launch.options.settingSources).toEqual(['user', 'project', 'local'])
    expect(launch.options.extraArgs).toMatchObject({
      settings: '/user/settings.json',
      'plugin-dir': '/user/plugin',
      'dangerously-skip-permissions': null
    })
    expect(spawn.sdkOptions.model).toBe('saved-model')
    expect(launch.env?.DISABLE_TELEMETRY).toBe('0')
  })

  it('keeps saved message choices from changing the Planner model after spawn', async () => {
    cleanup.push(
      registerClaudeMissionSessionPins('dispatch-message', 'session-1', {
        settingsPath: '/attempt/planner-settings.json',
        env: launchEnv,
        managedSettings,
        skills: [],
        model: 'policy-model',
        effort: 'high',
        accountHomePath: '/account/claude',
        mcpServers: {},
        denyPermission: () => {}
      })
    )
    const claude = fakeClaude({
      initModel: 'policy-model',
      settings: {
        effective: { effortLevel: 'high' },
        applied: { model: 'policy-model', effort: 'high' }
      }
    })
    const adapter = await acquired(claude, {
      missionPlanner: true,
      options: { model: 'policy-model', effort: 'high', settings: '/attempt/planner-settings.json' }
    })
    const connection = claude.connections[0]!
    connection.calls.length = 0
    await expect(
      adapter.dispatch({
        sessionId: 'session-1',
        clientMessageId: 'preamble',
        body: USER_MESSAGE,
        fence: 7,
        executionOptions: { model: 'saved-model', effort: 'low', fastMode: 'true' }
      })
    ).resolves.toMatchObject({ state: 'admitted' })
    expect(connection.calls).not.toContainEqual({
      subtype: 'set_model',
      params: { model: 'saved-model' }
    })
    expect(connection.calls).not.toContainEqual({
      subtype: 'apply_flag_settings',
      params: { settings: { effortLevel: 'low' } }
    })
    expect(connection.calls).not.toContainEqual({
      subtype: 'apply_flag_settings',
      params: { settings: { fastMode: true } }
    })
  })
})
