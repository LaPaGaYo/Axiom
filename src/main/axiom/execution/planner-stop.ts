import { z } from 'zod'
import type { OrcaRuntimeService } from '../../runtime/orca-runtime'
import { stopLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-stop'
import { releaseLocalWorker } from '../../runtime/rpc/methods/orchestration/worker/local-worker-release'
import type { AxiomStore } from '../db/axiom-store'

const pending = new WeakMap<AxiomStore, Map<string, Promise<string>>>()

export function stopPlanner(
  runtime: OrcaRuntimeService,
  store: AxiomStore,
  binding: { missionId: string; dispatchId: string },
  reason = 'plan_proposed'
): Promise<string> {
  let attempts = pending.get(store)
  if (!attempts) {
    attempts = new Map()
    pending.set(store, attempts)
  }
  const running = attempts.get(binding.dispatchId)
  if (running) {
    return running
  }
  const result = performPlannerStop(runtime, store, binding, reason).finally(() => {
    attempts.delete(binding.dispatchId)
  })
  attempts.set(binding.dispatchId, result)
  return result
}

async function performPlannerStop(
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
  const after = { state, releaseDisposition, reason }
  const previous = store
    .listAuditEvents({ missionId: binding.missionId })
    .findLast(
      (event) =>
        event.objectKind === 'attempt' &&
        event.objectId === binding.dispatchId &&
        event.event === 'planner.stopped'
    )
  if (JSON.stringify(previous?.after) === JSON.stringify(after)) {
    return state
  }
  store.appendAuditEvent({
    missionId: binding.missionId,
    actor: 'MissionController',
    objectKind: 'attempt',
    objectId: binding.dispatchId,
    event: 'planner.stopped',
    before: null,
    after
  })
  return state
}
