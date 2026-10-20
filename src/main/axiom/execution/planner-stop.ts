import { z } from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import type { AxiomStore } from '../db/axiom-store'

export async function stopPlanner(
  runtime: OrcaRuntimeService,
  store: AxiomStore,
  binding: { missionId: string; dispatchId: string },
  reason = 'plan_proposed'
) {
  let state = 'stop_unknown'
  let releaseDisposition = 'not_requested'
  try {
    state = z
      .object({ state: z.string() })
      .parse(await stopLocalWorker(runtime, binding.dispatchId)).state
    if (state !== 'stop_unknown') {
      releaseDisposition = (await releaseLocalWorker(runtime, binding.dispatchId)).state
    }
  } catch {
    // Proposal settlement is durable. Recovery retries resource maintenance after host failures.
    releaseDisposition = 'recovery_required'
  }
  store.appendAuditEvent({
    missionId: binding.missionId,
    actor: 'MissionController',
    objectKind: 'attempt',
    objectId: binding.dispatchId,
    event: 'planner.stopped',
    before: null,
    after: { state, releaseDisposition, reason }
  })
  return state
}
