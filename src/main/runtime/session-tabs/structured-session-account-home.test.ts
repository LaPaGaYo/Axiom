import { afterEach, expect, it, vi } from 'vitest'
import { OrcaRuntimeService } from '../orca-runtime'
import { resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'

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
