import type { ZCodeInteractiveCapability } from '../../shared/zcode-missing-tui'
import type { ProjectExecutionRuntimeResolution } from '../../shared/project-execution-runtime'
import type {
  PathSource,
  ShellHydrationFailureReason
} from '../../shared/shell-path-hydration-types'

import type { PreflightStatus } from '../../shared/preflight-status'
export type { PreflightStatus } from '../../shared/preflight-status'

export type RefreshAgentsResult = {
  agents: string[]
  addedPathSegments: string[]
  shellHydrationOk: boolean
  /** Drives agent_picks `on_path:false` triage (dashboard 1562016). `'shell_hydrate'` = detection saw the user's
   *  full shell PATH; `'sync_seed_only'` = hydration failed and detection ran against the `patchPackagedProcessPath` seed list. */
  pathSource: PathSource
  /** Classified hydration outcome: `'none'` on success, else a failure mode when `shellHydrationOk` is false. */
  pathFailureReason: ShellHydrationFailureReason
}

export type PreflightRuntimeContext = {
  wslDistro?: string | null
  wslDefault?: boolean
  projectRuntime?: ProjectExecutionRuntimeResolution
}

export type PreflightApi = {
  check: (args?: PreflightRuntimeContext & { force?: boolean }) => Promise<PreflightStatus>
  detectAgents: (args?: PreflightRuntimeContext) => Promise<string[]>
  /** Whether the installed `zcode` can open a session; cached in main per run. */
  zcodeInteractiveCapability: () => Promise<ZCodeInteractiveCapability>
  refreshAgents: (args?: PreflightRuntimeContext) => Promise<RefreshAgentsResult>
  detectRemoteAgents: (args: { connectionId: string }) => Promise<string[]>
  detectRemoteWindowsTerminalCapabilities: (args: { connectionId: string }) => Promise<{
    wslAvailable: boolean
    wslDistros: string[]
    pwshAvailable: boolean
    gitBashAvailable: boolean
    hostPlatform: NodeJS.Platform | null
  }>
}
