import { defineMethod } from '../../core'
import {
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

export const AXIOM_ATTEMPT_METHODS = [
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
