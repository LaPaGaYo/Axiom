import { releaseLocalWorker } from './local-worker-release'
import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { assertNotMissionManaged } from '../../../../../axiom/admission/mission-managed-run-guard'
import { defineMethod } from '../../../core'
import { releaseFederatedWorker } from '../federation/federated-worker-release'
import { ORCHESTRATION_WORKER_LIST_METHOD } from './worker-list-method'
import { resolvePinnedFederatedServer } from './worker-observation'
import { archiveSummary } from './worker-terminal-resource-presentation'
import type { WorkerReleaseReceipt } from './worker-release-completion'
import {
  WorkerDispatchParams,
  WorkerRetainParams
} from '../../../../../../shared/rpc-contract/orchestration-worker-release-schemas-params'
import { OrchestrationWorkerTerminalUserInputParams } from '../../../../../../shared/rpc-contract/orchestration-worker-release-params'

export const ORCHESTRATION_WORKER_RELEASE_METHODS = [
  defineMethod({
    name: 'orchestration.workerRelease',
    permission: 'workspace',
    params: WorkerDispatchParams,
    handler: async (params, { runtime, orchestrationMutation }): Promise<WorkerReleaseReceipt> => {
      const db = runtime.getOrchestrationDb()
      assertNotMissionManaged(runtime, {
        dispatchId: params.dispatch,
        verb: 'orchestration.workerRelease'
      })
      const federated = db.getFederatedDispatch(params.dispatch)
      if (federated) {
        if (!orchestrationMutation) {
          throw new OrchestrationError(
            'invalid_argument',
            'Remote worker-release requires a durable retry request.'
          )
        }
        return releaseFederatedWorker({
          runtime,
          server: resolvePinnedFederatedServer(runtime, federated),
          federated,
          dispatchId: params.dispatch,
          requestId: orchestrationMutation.requestId
        })
      }
      return releaseLocalWorker(runtime, params.dispatch)
    }
  }),
  defineMethod({
    name: 'orchestration.workerRetain',
    permission: 'workspace',
    params: WorkerRetainParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      assertNotMissionManaged(runtime, {
        dispatchId: params.dispatch,
        verb: 'orchestration.workerRetain'
      })
      const retained = db.retainWorkerTerminalResource(params.dispatch)
      if (retained.disposition === 'already_released') {
        return {
          dispatchId: params.dispatch,
          state: 'already_released' as const,
          processAction: 'none' as const,
          archive: archiveSummary(retained.resource)
        }
      }
      if (retained.disposition === 'no_owned_resource') {
        return {
          dispatchId: params.dispatch,
          state: 'retained' as const,
          reason: 'no_owned_resource' as const,
          processAction: 'none' as const,
          archive: null
        }
      }
      if (retained.disposition === 'release_committed') {
        const unknown = retained.resource.release_state === 'unknown'
        return {
          dispatchId: params.dispatch,
          state: unknown ? ('release_unknown' as const) : ('release_pending' as const),
          processAction: 'none' as const,
          archive: archiveSummary(retained.resource),
          ...(retained.resource.release_error
            ? { lastError: retained.resource.release_error }
            : {}),
          recovery:
            'Terminal release was already committed and could not be changed to retained; inspect worker-show before taking further action.'
        }
      }
      return {
        dispatchId: params.dispatch,
        state: 'retained' as const,
        reason: 'user_requested' as const,
        processAction: 'none' as const,
        archive: archiveSummary(retained.resource)
      }
    }
  }),
  ORCHESTRATION_WORKER_LIST_METHOD,
  defineMethod({
    name: 'orchestration.workerTerminalUserInput',
    permission: 'workspace',
    // `sessionId` addresses a worker that IS a structured agent session. Its pane key is a random
    // identity credential that never leaves main, so the caller names the session and the owning
    // runtime resolves it — a renderer echoing the pane key back would make it learnable.
    params: OrchestrationWorkerTerminalUserInputParams,
    // Real user keystrokes durably relinquish orchestration ownership on the owning runtime, so
    // restarts, SSH drops, remote viewing, and renderer remounts cannot erase the takeover.
    handler: (params, { runtime }) => {
      // A structured worker reports by session id; it has no pane of its own to name.
      const paneKey =
        params.paneKey ??
        (params.sessionId
          ? runtime.getStructuredWorkerPaneKeyForSession(params.sessionId)
          : runtime.getTerminalPaneKey(params.terminal!))
      assertNotMissionManaged(runtime, { paneKey, verb: 'orchestration.workerTerminalUserInput' })
      const changed = paneKey
        ? runtime.getOrchestrationDb().markWorkerTerminalUserOwned(paneKey)
        : 0
      return { changed }
    }
  })
]
