import { defineMethod } from '../../core'
import { requirePolicy } from '../../../../axiom/mission-controller/policy-update'
import {
  PolicyShowParams,
  PolicyUpdateParams
} from '../../../../../shared/axiom-contract/policy-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'

export const AXIOM_POLICY_METHODS = [
  defineMethod({
    name: 'axiom.policy.show',
    permission: 'workspace',
    params: PolicyShowParams,
    handler: async (p, { runtime }) => {
      const { store, agentFactory } = getAxiomControlPlane(runtime)
      const policy = requirePolicy(store, p.missionId)
      return {
        policy,
        ...(p.providers ? { providers: await agentFactory.providerEligibility(p.missionId) } : {})
      }
    }
  }),
  defineMethod({
    name: 'axiom.policy.update',
    permission: 'workspace',
    params: PolicyUpdateParams,
    handler: (p, { runtime }) => getAxiomControlPlane(runtime).missions.updatePolicy(p)
  })
]
