import { defineMethod } from '../../core'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import {
  showSupervision,
  updateSupervision
} from '../../../../axiom/supervision/supervision-settings'
import {
  SupervisionShowParams,
  SupervisionUpdateParams
} from '../../../../../shared/axiom-contract/supervision'

export const AXIOM_SUPERVISION_METHODS = [
  defineMethod({
    name: 'axiom.supervision.show',
    permission: 'workspace',
    params: SupervisionShowParams,
    handler: (p, { runtime }) =>
      showSupervision(
        {
          store: getAxiomControlPlane(runtime).store,
          db: runtime.getOrchestrationDb()
        },
        p
      )
  }),
  defineMethod({
    name: 'axiom.supervision.update',
    permission: 'workspace',
    params: SupervisionUpdateParams,
    handler: (p, { runtime }) =>
      updateSupervision(
        {
          store: getAxiomControlPlane(runtime).store,
          db: runtime.getOrchestrationDb()
        },
        p
      )
  })
]
