import { archiveSummary } from './worker-terminal-resource-presentation'
import type { OrcaRuntimeService } from '../../../../orca-runtime'
import {
  completeWorkerTerminalRelease,
  type WorkerReleaseReceipt
} from './worker-release-completion'

export async function releaseLocalWorker(
  runtime: OrcaRuntimeService,
  dispatchId: string
): Promise<WorkerReleaseReceipt> {
  const db = runtime.getOrchestrationDb()
  const requested = db.requestWorkerTerminalRelease(dispatchId)
  if (requested.disposition === 'already_released') {
    return {
      dispatchId: dispatchId,
      state: 'already_released',
      processAction: 'none',
      archive: archiveSummary(requested.resource)
    }
  }
  if (requested.disposition === 'retained') {
    const resource = requested.resource
    const processIncarnation = resource?.process_incarnation
    if (
      processIncarnation &&
      (await runtime.inspectTerminalProcessIncarnationLiveness(
        processIncarnation,
        resource.host_scope
      )) === 'exited'
    ) {
      const reconciled = db.settleDeadWorkerTerminalRelease({
        requestingDispatchId: dispatchId,
        resourceId: resource.id,
        processIncarnation
      })
      if (reconciled.disposition === 'released') {
        runtime.notifyMessageArrived(`dispatch:${dispatchId}`, 'status')
        return {
          dispatchId: dispatchId,
          state: 'released',
          processAction: 'none',
          archive: archiveSummary(reconciled.resource)
        }
      }
    }
    return {
      dispatchId: dispatchId,
      state: 'retained',
      reason: requested.reason,
      processAction: 'none',
      archive: archiveSummary(resource)
    }
  }
  return completeWorkerTerminalRelease({
    runtime,
    db,
    dispatchId: dispatchId,
    resource: requested.resource
  })
}
