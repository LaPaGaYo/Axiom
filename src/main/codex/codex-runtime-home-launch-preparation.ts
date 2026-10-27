import { isProviderActivated } from '../provider-activation/provider-activation'
import type { CodexHomeLaunchContext } from '../ipc/pty/host-env/types'
import type { CodexAccountSelectionTarget } from '../codex-accounts/runtime-selection'
import type { CodexRuntimeHomeService } from '../codex-accounts/runtime-home-service'
import type { GlobalSettings } from '../../shared/global-settings-types'
import { codexHookService } from './hook-service'
import { getDefaultWslDistro } from '../wsl'
import { isAgentStatusHooksEnabledForAgent } from '../agent-hooks/managed-agent-hook-controls'
import { reconcileCodexHooksForLaunch } from './codex-hook-reconcile'
import { reconcileCodexAccountHomeHook } from './codex-account-home-hook'
import { CodexAccountRequiredError, usesCodexAccountHomeLayout } from './codex-home-paths'

/** Codex launch prep against a host's runtime-home service; the desktop and orcad share it. */
export function createCodexRuntimeHomeLaunchPreparation(deps: {
  onCodexLaunch?: () => void
  getRuntimeHome: () => CodexRuntimeHomeService | null
  getSettings: () => GlobalSettings | undefined
}) {
  return async (
    target?: CodexAccountSelectionTarget,
    launchEnv?: NodeJS.ProcessEnv,
    launchContext?: CodexHomeLaunchContext
  ): Promise<string | null> => {
    const runtimeHome = deps.getRuntimeHome()
    if (!runtimeHome) {
      throw new Error('Codex runtime home service is not initialized')
    }
    const launchesCodex = launchContext?.launchesCodex === true
    if (launchesCodex) {
      deps.onCodexLaunch?.()
    }
    // D83 ruling ③: a plain shell without a selected account keeps the user's home.
    if (
      process.platform !== 'win32' &&
      target?.runtime !== 'wsl' &&
      !launchesCodex &&
      !runtimeHome.getSelectedHostAccountCodexHomePath()
    ) {
      return null
    }
    const mayPrepareHooks = launchesCodex || isProviderActivated(deps.getSettings(), 'codex')
    // Why: a ManagedCodexHomeTemporarilyUnavailableError must escape uncaught —
    // the fallbacks below all key off `null`, which means "system default", so
    // swallowing the refusal would launch the wrong account (#STA-4422).
    const runtimeHomePath = await runtimeHome.prepareForCodexLaunchAsync(target, launchEnv, {
      unavailableManagedHomePath: launchContext?.unavailableManagedHomePath
    })
    if (runtimeHomePath === null && process.platform !== 'win32' && target?.runtime !== 'wsl') {
      throw new CodexAccountRequiredError()
    }
    if (!mayPrepareHooks) {
      return runtimeHomePath
    }
    if (runtimeHomePath === null && target?.runtime !== 'wsl') {
      // Why only a Codex launch waits: the pane spawn already schedules the reconcile, which
      // writes only on a change; plain terminals and structured launches never wait on it.
      if (launchesCodex) {
        await reconcileCodexHooksForLaunch()
      }
      return null
    }
    const hookTarget =
      target?.runtime === 'wsl'
        ? { runtime: 'wsl' as const, wslDistro: target.wslDistro?.trim() || getDefaultWslDistro() }
        : target
    const isHooksEnabled = (): boolean =>
      isAgentStatusHooksEnabledForAgent(deps.getSettings(), 'codex')
    const hooksEnabled = isHooksEnabled()
    try {
      if (
        runtimeHomePath &&
        target?.runtime !== 'wsl' &&
        usesCodexAccountHomeLayout(runtimeHomePath)
      ) {
        await reconcileCodexAccountHomeHook(runtimeHomePath, isHooksEnabled, launchesCodex)
        return runtimeHomePath
      }
      // Why: honor the persisted off switch so post-startup launches can't reinstall removed hooks.
      const status = await codexHookService.prepareRuntimeHomeForLaunch(
        runtimeHomePath,
        hookTarget,
        isHooksEnabled,
        launchesCodex
      )
      if (status.state === 'error') {
        console.warn(
          `[codex-hook-service] failed to ${hooksEnabled ? 'refresh' : 'refresh user'} runtime hooks before launch`,
          status.detail
        )
      }
    } catch (error) {
      // Why: hook install is best-effort launch prep; a malformed hooks file must not block Codex from starting.
      console.warn(
        `[codex-hook-service] failed to ${hooksEnabled ? 'refresh' : 'refresh user'} runtime hooks before launch`,
        error
      )
    }
    return runtimeHomePath
  }
}
