import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'
import { getAppEnvironment, hasAppEnvironment } from '../../../shared/app-environment'

export type OrchestrationCliCommand = 'orca' | 'orca-dev' | 'orca-ide' | 'axiom' | 'axiom-dev'

/** Dev builds run the CLI as `axiom-dev`; a packaged app, or a process with no app, must not advertise it. */
export function runtimeOrchestrationCliCommand(): OrchestrationCliCommand | undefined {
  return hasAppEnvironment() && !getAppEnvironment().isPackaged() ? 'axiom-dev' : undefined
}

/** What a local, non-WSL terminal is told to run; a structured session is always one. */
export function localOrchestrationCliCommand(): OrchestrationCliCommand {
  return runtimeOrchestrationCliCommand() ?? 'axiom'
}

export function resolveTerminalOrchestrationCliCommand(args: {
  connectionId: string | null
  isWsl: boolean | null | undefined
  worktreeId: string
  projectRuntime?: ProjectExecutionRuntimeResolution
  runtimeCliCommand?: OrchestrationCliCommand
}): OrchestrationCliCommand {
  if (args.connectionId) {
    return 'axiom'
  }
  if (args.runtimeCliCommand) {
    return args.runtimeCliCommand
  }
  return 'axiom'
}
