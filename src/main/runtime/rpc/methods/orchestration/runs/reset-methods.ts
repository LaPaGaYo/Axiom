import { assertResetAllowed } from '../../../../../axiom/admission/mission-managed-run-guard'
import { defineMethod } from '../../../core'
import { ResetParams } from '../schemas'

export const ORCHESTRATION_RESET_METHODS = [
  defineMethod({
    name: 'orchestration.reset',
    params: ResetParams,
    handler: (params, { runtime }) => {
      const db = runtime.getOrchestrationDb()
      assertResetAllowed(runtime, params)
      if (params.all) {
        runtime.stopOrchestrationFederationRelay()
        db.resetAll()
        return { reset: 'all' }
      }
      if (params.tasks) {
        runtime.stopOrchestrationFederationRelay()
        db.resetTasks()
        return { reset: 'tasks' }
      }
      if (params.messages) {
        db.resetMessages()
        return { reset: 'messages' }
      }
      throw new Error('Invalid reset scope')
    }
  })
]
