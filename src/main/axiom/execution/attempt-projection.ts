import {
  AttemptSummarySchema,
  projectAttemptState
} from '../../../shared/axiom-contract/attempt-params'
import type { OrchestrationFleetWorker } from '../../../shared/orchestration-fleet-projection'
import type { AxiomStore } from '../db/axiom-store'

export function projectAttempt(
  store: AxiomStore,
  binding: NonNullable<ReturnType<AxiomStore['getAttemptBinding']>>,
  projectFleetWorker: (dispatchId: string) => OrchestrationFleetWorker | null
) {
  const worker = binding.dispatchId === null ? null : projectFleetWorker(binding.dispatchId)
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
    liveness: worker?.liveness.verdict ?? null,
    workspace:
      release == null
        ? null
        : release === 'retained' || release === 'released'
          ? release
          : 'pending',
    worktreeId: worker?.workspace?.id ?? null
  })
}
