import type { ProjectExecutionRuntimeResolution } from '../../../shared/project-execution-runtime'

export type OrchestrationCliCommand = 'orca' | 'orca-dev' | 'orca-ide' | 'axiom' | 'axiom-dev'

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
