import type { OrcaRuntimeService } from '../../../../orca-runtime'
import type { OrchestrationDb } from '../../../../orchestration/db'
import type { DispatchContextRow, RunRow, TaskRow } from '../../../../orchestration/types'
import type {
  OrchestrationCallerIdentity,
  OrchestrationSessionCaller
} from '../../../../orchestration/orchestration-caller-identity'
import type { WorkerStartInput } from './worker-start-schema'
import type { ControlPlaneWorkerStart } from './control-plane-worker-start'
import type { WorkerStartMutation } from './worker-start-mutation'
import type { WorkerStartModeReceipt } from '../../orchestration-worker-start-mode'

export type LocalWorkerStartInput = {
  params: WorkerStartInput
  runtime: OrcaRuntimeService
  db: OrchestrationDb
  run: RunRow
  coordinator: OrchestrationCallerIdentity | null
  callerSession?: OrchestrationSessionCaller
  existingTask?: TaskRow
  orchestrationMutation?: WorkerStartMutation
  controlPlane?: ControlPlaneWorkerStart
  /** Settings-driven; the executing host still gets to refuse below. */
  mode: WorkerStartModeReceipt
  /** Set when a worker starts its own helper; the helper reports to this Dispatch. */
  helperCreator?: DispatchContextRow
}
