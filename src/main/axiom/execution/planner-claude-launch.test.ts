import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getAppEnvironment } from '../../../shared/app-environment'
import { createClaudePlannerLaunch } from './planner-claude-launch'
import { claudePlannerSessionPins } from './planner-claude-session'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { ClaudePromptRegistry } from '../../claude/claude-prompt-registry'
import { buildClaudePermissionCallbacks } from '../../claude/claude-structured-inbound-control'

let directory: string
let f: Awaited<ReturnType<typeof plannerFixture>>
const cleanup: (() => void)[] = []
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), 'axiom-claude-planner-'))
  f = await plannerFixture()
  vi.spyOn(getAppEnvironment(), 'getPath').mockReturnValue(directory)
})
afterEach(async () => {
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
  await f.close()
  await rm(directory, { recursive: true, force: true })
})

async function prepare() {
  const launch = createClaudePlannerLaunch({
    store: f.store,
    missionId: f.mission.id,
    model: 'policy-default',
    effort: 'high',
    resolveAccountHome: async () => '/account/claude',
    settings: () => ({ codexAccountHomeAllowlist: { skills: ['review'], mcpServers: [] } })
  })
  const dispose = await launch.prepare({ dispatchId: 'ctx_planner', sessionId: 's_planner' })
  cleanup.push(dispose)
  return { dispose, pins: claudePlannerSessionPins('s_planner')! }
}

describe('Claude Planner isolation', () => {
  it('writes only the invocation read/propose rules and registers the skill allowlist', async () => {
    const { pins } = await prepare()
    const settingsPath = path.join(
      directory,
      'axiom',
      'attempts',
      'ctx_planner',
      'planner-settings.json'
    )
    expect(pins).toMatchObject({
      settingsPath,
      skills: ['review'],
      effort: 'high',
      accountHomePath: '/account/claude'
    })
    expect(pins.model).toBeUndefined()
    expect(JSON.parse(await readFile(settingsPath, 'utf8'))).toEqual({
      permissions: {
        allow: [
          'Read',
          'Grep',
          'Glob',
          'LS',
          'Bash(git log:*)',
          'Bash(git diff:*)',
          'Bash(git show:*)',
          `Bash(axiom plan propose --mission ${f.mission.id} --attempt ctx_planner --file:*)`
        ],
        deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']
      },
      syncClaudeAiSkills: false,
      syncClaudeAiPlugins: false,
      enabledPlugins: {}
    })
    expect((await stat(settingsPath)).mode & 0o777).toBe(0o600)
  })

  it('denies without publishing a prompt and records no raw tool inputs', async () => {
    await prepare()
    const prompts = new ClaudePromptRegistry('s_planner')
    const emit = vi.fn()
    const { canUseTool } = buildClaudePermissionCallbacks({ sessionId: 's_planner', prompts, emit })
    const result = canUseTool(
      'Bash',
      { command: 'curl secret-value' },
      {
        requestId: 'permission-one',
        toolUseID: 'tool-one',
        signal: new AbortController().signal,
        description: 'secret-value',
        decisionReason: 'secret-value'
      }
    )
    expect(prompts.find('permission-one')).toBeNull()
    await expect(result).resolves.toMatchObject({ behavior: 'deny', toolUseID: 'tool-one' })
    expect(emit).not.toHaveBeenCalled()
    const events = f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((event) => event.event === 'attempt.permission_denied')
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      objectId: 'ctx_planner',
      after: {
        toolName: 'Bash',
        summary: 'Mission Planner denied a tool request outside its allow rules.'
      }
    })
    expect(JSON.stringify(events)).not.toContain('secret-value')
  })

  it('removes the registry entry on release while an acquired prompt registry stays deny-safe', async () => {
    const { dispose } = await prepare()
    const prompts = new ClaudePromptRegistry('s_planner')
    dispose()
    expect(claudePlannerSessionPins('s_planner')).toBeUndefined()
    expect(
      prompts.register({
        requestId: 'late',
        toolUseId: 'tool',
        toolName: 'Write',
        input: {},
        suggestions: [],
        settle: () => {}
      })
    ).toBeNull()
    expect(
      new ClaudePromptRegistry('ordinary').register({
        requestId: 'ordinary',
        toolUseId: 'tool',
        toolName: 'Write',
        input: {},
        suggestions: [],
        settle: () => {}
      })
    ).not.toBeNull()
  })

  it.each(['claude', 'codex'])(
    'wires the Planner preparation hook only for Claude: %s',
    async (provider) => {
      f.installed.mockResolvedValue([provider])
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this launch reads only getSettings; the kernel start is stubbed.
      vi.spyOn(f.runtime, 'requireStore').mockReturnValue({
        getSettings: () => ({
          experimentalNativeChat: false,
          nativeChatProviders: { claude: false }
        })
      } as never)
      await createPlannerLauncher(f.deps).start(f.mission.id)
      const [binding] = f.store.listPlannerBindings(f.mission.id)
      const { content } = await f.artifacts.read(binding.contextPackageId)
      expect(content.toString('utf8').includes('/dev/stdin')).toBe(provider === 'claude')
      const prepare = f.startWorker.mock.calls[0]?.[0].controlPlane?.structured?.prepare
      expect(f.startWorker.mock.calls[0]?.[0].mode?.mode).toBe(
        provider === 'claude' ? 'structured' : 'terminal'
      )
      if (provider === 'claude') {
        expect(prepare).toBeTypeOf('function')
      } else {
        expect(prepare).toBeUndefined()
      }
    }
  )

  it('refuses before registration when the selected account resolves to no managed home', async () => {
    const launch = createClaudePlannerLaunch({
      store: f.store,
      missionId: f.mission.id,
      model: 'policy-default',
      effort: 'high',
      settings: () => ({}),
      resolveAccountHome: async () => null
    })
    await expect(
      launch.prepare({ dispatchId: 'no_account', sessionId: 'no_account' })
    ).rejects.toMatchObject({ code: 'no_account' })
    expect(claudePlannerSessionPins('no_account')).toBeUndefined()
  })
})
