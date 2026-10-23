import { OrchestrationError } from '../../../../orchestration/orchestration-error'
import { assertNotMissionManaged } from '../../../../../axiom/admission/mission-managed-run-guard'
import { defineMethod } from '../../../core'
import { ORCHESTRATION_WORKER_STOP_VERDICT_RUNTIME_CAPABILITY } from '../../../../../../shared/protocol-version'
import type { RuntimeStatus } from '../../../../../../shared/runtime-types'
import { resolvePinnedFederatedServer } from './worker-observation'
import { WorkerDispatchParams } from '../../../../../../shared/rpc-contract/orchestration-worker-stop-params'
import {
  stopLocalWorker,
  dedupeWorkerStop,
  settledReceipt,
  unknownReceipt
} from './local-worker-stop'

export const ORCHESTRATION_WORKER_STOP_METHODS = [
  defineMethod({
    name: 'orchestration.workerStop',
    permission: 'workspace',
    params: WorkerDispatchParams,
    handler: (params, { runtime, orchestrationMutation }) => {
      const db = runtime.getOrchestrationDb()
      assertNotMissionManaged(runtime, {
        dispatchId: params.dispatch,
        verb: 'orchestration.workerStop'
      })
      const federated = db.getFederatedDispatch(params.dispatch)
      if (!federated) {
        return stopLocalWorker(runtime, params.dispatch)
      }
      return dedupeWorkerStop(runtime, params.dispatch, async () => {
        if (!orchestrationMutation) {
          throw new OrchestrationError(
            'invalid_argument',
            'Remote worker-stop requires a durable retry request.'
          )
        }
        const server = resolvePinnedFederatedServer(runtime, federated)
        const begun = db.beginWorkerStop(params.dispatch, runtime.getRuntimeId())
        if (begun.disposition === 'already_settled') {
          return settledReceipt(params.dispatch, begun.worker.state)
        }
        try {
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the pinned peer returns the established status.get contract; extraction preserves the existing wire path.
          const status = (await runtime.callOrchestrationWorkerServer(
            server.environmentId,
            'status.get',
            undefined,
            30_000,
            undefined,
            { expectedEnvironmentPairingRevision: server.pairingRevision }
          )) as RuntimeStatus
          if (
            !status.capabilities?.includes(ORCHESTRATION_WORKER_STOP_VERDICT_RUNTIME_CAPABILITY)
          ) {
            return unknownReceipt(
              params.dispatch,
              db.markWorkerStopUnknown(
                params.dispatch,
                `Connected server ${server.name} cannot prove the worker stop outcome.`
              ),
              'none'
            )
          }
          // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: capability negotiation above selects the existing federationStop receipt contract.
          const remote = (await runtime.callOrchestrationWorkerServer(
            server.environmentId,
            'orchestration.federationStop',
            { dispatchId: params.dispatch },
            30_000,
            { orchestrationRequestId: orchestrationMutation.requestId },
            { expectedEnvironmentPairingRevision: server.pairingRevision }
          )) as RemoteStopReceipt
          if (remote.state === 'stopped') {
            const worker = db.reconcileFederatedWorkerStop(params.dispatch)
            return {
              dispatchId: params.dispatch,
              state: worker.state,
              alreadySettled: remote.alreadySettled,
              processAction: remote.processAction,
              close: remote.close
            }
          }
          if (remote.state === 'succeeded' || remote.state === 'failed') {
            db.resumeFederatedWorkerForTerminalRelay(params.dispatch)
            await runtime
              .syncOrchestrationFederatedDispatchAfterCurrent(params.dispatch)
              .catch(() => undefined)
            return {
              dispatchId: params.dispatch,
              state: db.getWorkerDispatch(params.dispatch)?.state ?? remote.state,
              alreadySettled: true,
              processAction: 'none'
            }
          }
          return unknownReceipt(
            params.dispatch,
            db.markWorkerStopUnknown(
              params.dispatch,
              remote.lastError ?? `The worker server returned ${remote.state}.`
            ),
            remote.processAction
          )
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error)
          return unknownReceipt(
            params.dispatch,
            db.markWorkerStopUnknown(params.dispatch, reason),
            'unknown'
          )
        }
      })
    }
  })
]

type RemoteStopReceipt = {
  state: string
  alreadySettled: boolean
  processAction: string
  close?: unknown
  lastError?: string | null
}
