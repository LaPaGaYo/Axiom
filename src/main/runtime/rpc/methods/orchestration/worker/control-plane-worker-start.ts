import type { DispatchCreator } from '../../../../orchestration/db/dispatch-depth'
import type { OrchestrationCallerIdentity } from '../../../../orchestration/orchestration-caller-identity'
import type { PreambleParams } from '../../../../orchestration/preamble'

// Why: D14 trusts these service-only inputs from the in-process Control Plane, never RPC params.
export type ControlPlaneWorkerStart = {
  dispatchCreator?: DispatchCreator
  worktreeId?: string
  branchNameOverride?: string
  preambleBuilder?: (params: PreambleParams) => string
  dispatchMaxDepth?: number
  callerIdentity?: OrchestrationCallerIdentity
}
