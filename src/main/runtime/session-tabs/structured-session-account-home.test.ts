import { afterEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'
import * as metadata from '../structured-agent-runtime-metadata'
import * as profilePaths from '../../orca-profiles/profile-storage-paths'

afterEach(() => vi.restoreAllMocks())
it.each([undefined, { codex: { CODEX_HOME: '/temporary/home', CUSTOM: 'value' } }])(
  'resolves Worker homes with the Codex launch environment, without preparing hooks',
  (agentDefaultEnv) => {
    const resolve = vi.fn(() => '/temporary/selected-account')
    const prepare = vi.fn()
    const runtime = new OrcaRuntimeService(null, undefined, {
      resolveCodexStructuredLaunchHome: resolve,
      prepareCodexStructuredLaunch: prepare
    })
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: this seam only reads getSettings().agentDefaultEnv.
    vi.spyOn(runtime, 'requireStore').mockReturnValue({
      getSettings: () => ({ agentDefaultEnv })
    } as never)
    expect(runtime.resolveCodexHomeForWorkerLaunch()).toBe('/temporary/selected-account')
    expect(resolve).toHaveBeenCalledExactlyOnceWith({
      launchEnv: resolveTuiAgentLaunchEnv('codex', agentDefaultEnv)
    })
    expect(prepare).not.toHaveBeenCalled()
  }
)
it('refuses an uninitialized read-only home resolver', () => {
  expect(() => new OrcaRuntimeService().resolveCodexHomeForWorkerLaunch()).toThrow(
    /not initialized/
  )
})

it('resolves the selected Claude account through its launch registration with no ambient override', async () => {
  const runtime = new OrcaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only getSettings is used by this account resolver.
  vi.spyOn(runtime, 'requireStore').mockReturnValue({
    getSettings: () => ({
      activeClaudeManagedAccountId: 'selected',
      agentDefaultEnv: { claude: { CLAUDE_CONFIG_DIR: '/user/home' } }
    })
  } as never)
  const original = metadata.structuredAgentRuntimeMetadata('claude')!
  vi.spyOn(profilePaths, 'getProfileUserDataPath').mockReturnValue('/managed')
  const resolveAccountHome = vi.fn(async () => ({
    variable: 'CLAUDE_CONFIG_DIR',
    path: '/managed/claude-profiles/selected/home'
  }))
  vi.spyOn(metadata, 'structuredAgentRuntimeMetadata').mockReturnValue({
    ...original,
    resolveAccountHome
  })
  expect(await runtime.resolveClaudeHomeForWorkerLaunch()).toBe(
    '/managed/claude-profiles/selected/home'
  )
  expect(resolveAccountHome).toHaveBeenCalledWith(
    expect.objectContaining({ purpose: 'launch', launchEnv: {} }),
    expect.anything()
  )
})

it('refuses a registration fallback to system home even when a managed account is selected', async () => {
  const runtime = new OrcaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only getSettings is used by this resolver.
  vi.spyOn(runtime, 'requireStore').mockReturnValue({
    getSettings: () => ({ activeClaudeManagedAccountId: 'selected' })
  } as never)
  vi.spyOn(profilePaths, 'getProfileUserDataPath').mockReturnValue('/managed')
  const original = metadata.structuredAgentRuntimeMetadata('claude')!
  vi.spyOn(metadata, 'structuredAgentRuntimeMetadata').mockReturnValue({
    ...original,
    resolveAccountHome: async () => ({ variable: 'CLAUDE_CONFIG_DIR', path: '/user/.claude' })
  })
  expect(await runtime.resolveClaudeHomeForWorkerLaunch()).toBeNull()
})

it('refuses Claude system default before resolving any home', async () => {
  const runtime = new OrcaRuntimeService()
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: only getSettings is used by this account resolver.
  vi.spyOn(runtime, 'requireStore').mockReturnValue({
    getSettings: () => ({ activeClaudeManagedAccountId: null })
  } as never)
  const resolver = vi.spyOn(metadata, 'structuredAgentRuntimeMetadata')
  expect(await runtime.resolveClaudeHomeForWorkerLaunch()).toBeNull()
  expect(resolver).not.toHaveBeenCalled()
})
