import type { CodexWorkerLaunchHome } from '../../codex/codex-worker-launch-home'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { startLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-start'
import type { resolveHostAgentBaseEnvironment } from '../../runtime/structured-agent-shell-environment'
import type { AxiomStore } from '../db/axiom-store'
import type { MissionController } from '../mission-controller/mission-controller'
import type { ArtifactStore } from '../artifacts/artifact-store'

type LauncherRuntime = Pick<OrcaRuntimeService, 'createManagedWorktree' | 'requireStore'> &
  Partial<Pick<OrcaRuntimeService, 'resolveClaudeHomeForWorkerLaunch'>>
export type AttemptWorkerStartArgs = Omit<Parameters<typeof startLocalWorker>[0], 'runtime'> & {
  runtime: LauncherRuntime
}
export type AttemptLauncherDependencies = {
  db: OrchestrationDb
  store: AxiomStore
  missions: MissionController
  artifacts: ArtifactStore
  now?: () => string
  codexWorkerHome?: () => Promise<CodexWorkerLaunchHome>
  resolveBaseEnvironment?: (
    settings: Parameters<typeof resolveHostAgentBaseEnvironment>[0]
  ) => Promise<NodeJS.ProcessEnv>
} & (
  | { runtime: OrcaRuntimeService; startWorker?: undefined }
  | { runtime: LauncherRuntime; startWorker: (args: AttemptWorkerStartArgs) => Promise<unknown> }
)
