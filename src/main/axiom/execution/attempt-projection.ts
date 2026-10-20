import {
  AttemptSummarySchema,
  projectAttemptState
} from '../../../shared/axiom-contract/attempt-params'
import type { OrchestrationFleetWorker } from '../../../shared/orchestration-fleet-projection'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import type { AxiomStore } from '../db/axiom-store'

export function foldAttemptLiveness(
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>
) {
  return observation.status === 'live' || observation.status === 'exited'
    ? observation.status
    : 'unverifiable'
}

export async function projectAttempt(
  store: AxiomStore,
  binding: NonNullable<ReturnType<AxiomStore['getAttemptBinding']>>,
  projectFleetWorker: (dispatchId: string) => OrchestrationFleetWorker | null,
  inspectTerminal: (dispatchId: string) => ReturnType<typeof inspectWorkerTerminal>
) {
  const worker = binding.dispatchId === null ? null : projectFleetWorker(binding.dispatchId)
  const observation = binding.dispatchId === null ? null : await inspectTerminal(binding.dispatchId)
  const liveness = observation ? foldAttemptLiveness(observation) : null
  const release = worker?.resource.state === 'absent' ? null : worker?.resource.releaseState
  return AttemptSummarySchema.parse({
    ...binding,
    attemptId: binding.dispatchId,
    provider:
      store.getAgentSpec(binding.agentSpecId)?.spec.provider ?? worker?.provider?.id ?? null,
    state:
      binding.dispatchId === null
        ? 'LAUNCH_PENDING'
        : worker
          ? projectAttemptState(worker.stage)
          : 'START_UNKNOWN',
    liveness,
    livenessReason:
      observation?.reason ?? (liveness === 'unverifiable' ? observation?.status : null),
    workspace:
      release == null
        ? null
        : release === 'retained' || release === 'released'
          ? release
          : 'pending',
    worktreeId: worker?.workspace?.id ?? null
  })
}
