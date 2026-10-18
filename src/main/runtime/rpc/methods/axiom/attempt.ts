import { defineMethod, type RpcContext } from '../../core'
import { askAttempt } from '../../../../axiom/execution/attempt-ask'
import type { z } from 'zod'
import {
  AttemptMessageParams,
  AttemptAskParams,
  AttemptRequestSubtaskParams,
  AttemptCheckParams,
  AttemptListParams,
  AttemptShowParams,
  type AttemptSummary
} from '../../../../../shared/axiom-contract/attempt-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import { projectAttempt } from '../../../../axiom/execution/attempt-projection'
import {
  inspectWorkerTerminal,
  projectFleetWorker
} from '../orchestration/worker/worker-observation'
import { OrchestrationError } from '../../../orchestration/orchestration-error'
import { resolveAttemptSender } from '../../../../axiom/execution/attempt-authority'
import { routeWorkerMessage } from '../../../../axiom/messaging/message-router'
import { checkWorkerMailbox } from '../orchestration/messaging/check-worker'
import { parseMessageTypes } from '../orchestration/routing'

function sendAttemptMessage(
  type: 'INFORM' | 'REQUEST' | 'BLOCKED' | 'HANDOFF' | 'REQUEST_SUBTASK',
  p: z.infer<typeof AttemptMessageParams> | z.infer<typeof AttemptRequestSubtaskParams>,
  ctx: RpcContext
) {
  const { runtime, orchestrationCaller, orchestrationCapability, recordMutationReceipt } = ctx
  const db = runtime.getOrchestrationDb()
  const { store } = getAxiomControlPlane(runtime)
  const { mission, task, sender } = resolveAttemptSender({
    runtime,
    db,
    store,
    ...p,
    orchestrationCaller,
    orchestrationCapability
  })
  return routeWorkerMessage(
    { runtime, db, store, recordMutationReceipt },
    {
      sender,
      body: p.body,
      axiom: {
        version: 1,
        type,
        missionId: mission.id,
        taskId: task.taskId,
        attemptId: p.attemptId,
        summary: p.summary,
        artifactIds: p.artifactIds,
        related: p.related,
        ...('subtask' in p ? { subtask: p.subtask } : {})
      }
    }
  )
}

export const AXIOM_ATTEMPT_METHODS = [
  defineMethod({ name: 'axiom.attempt.ask', params: AttemptAskParams, handler: askAttempt }),
  defineMethod({
    name: 'axiom.attempt.inform',
    params: AttemptMessageParams,
    handler: (p, ctx) => sendAttemptMessage('INFORM', p, ctx)
  }),
  defineMethod({
    name: 'axiom.attempt.request',
    params: AttemptMessageParams,
    handler: (p, ctx) => sendAttemptMessage('REQUEST', p, ctx)
  }),
  defineMethod({
    name: 'axiom.attempt.blocked',
    params: AttemptMessageParams,
    handler: (p, ctx) => sendAttemptMessage('BLOCKED', p, ctx)
  }),
  defineMethod({
    name: 'axiom.attempt.handoff',
    params: AttemptMessageParams,
    handler: (p, ctx) => sendAttemptMessage('HANDOFF', p, ctx)
  }),
  defineMethod({
    name: 'axiom.attempt.request-subtask',
    params: AttemptRequestSubtaskParams,
    handler: (p, ctx) => sendAttemptMessage('REQUEST_SUBTASK', p, ctx)
  }),
  defineMethod({
    name: 'axiom.attempt.check',
    params: AttemptCheckParams,
    handler: (p, { runtime, orchestrationCaller, orchestrationCapability, signal }) => {
      const db = runtime.getOrchestrationDb()
      const { store } = getAxiomControlPlane(runtime)
      const { sender, dispatch } = resolveAttemptSender({
        runtime,
        db,
        store,
        ...p,
        orchestrationCaller,
        orchestrationCapability
      })
      return checkWorkerMailbox({
        params: { terminal: p.from, wait: p.wait, timeoutMs: p.timeoutMs, types: p.type },
        runtime,
        db,
        handle: p.from,
        paneKey: sender.paneKey ?? undefined,
        typeFilter: parseMessageTypes(p.type),
        signal,
        activeDispatch: dispatch,
        remoteAttachment: undefined
      })
    }
  }),
  defineMethod({
    name: 'axiom.attempt.show',
    params: AttemptShowParams,
    handler: async (p, { runtime }) => {
      const { store } = getAxiomControlPlane(runtime)
      const binding = store.getAttemptBindingByDispatch(p.attemptId)
      if (!binding) {
        throw new OrchestrationError('attempt_not_found', 'Attempt was not found.')
      }
      return {
        attempt: await projectAttempt(
          store,
          binding,
          (id) => projectFleetWorker(runtime, runtime.getOrchestrationDb(), id),
          (id) => inspectWorkerTerminal(runtime, runtime.getOrchestrationDb(), id)
        )
      }
    }
  }),
  defineMethod({
    name: 'axiom.attempt.list',
    params: AttemptListParams,
    handler: async (p, { runtime }) => {
      const { store, missions } = getAxiomControlPlane(runtime)
      missions.getMission(p.missionId)
      const attempts: AttemptSummary[] = []
      for (const binding of store.listAttemptBindings(p)) {
        attempts.push(
          await projectAttempt(
            store,
            binding,
            (id) => projectFleetWorker(runtime, runtime.getOrchestrationDb(), id),
            (id) => inspectWorkerTerminal(runtime, runtime.getOrchestrationDb(), id)
          )
        )
      }
      return { attempts }
    }
  })
]
