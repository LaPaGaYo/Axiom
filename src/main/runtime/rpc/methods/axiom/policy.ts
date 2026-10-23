import { defineMethod } from '../../core'
import {
  PolicyShowParams,
  PolicyUpdateParams
} from '../../../../../shared/axiom-contract/policy-params'
import { getAxiomControlPlane } from '../../../../axiom/control-plane'
import type { AxiomStore } from '../../../../axiom/db/axiom-store'
import { MissionControllerError } from '../../../../axiom/mission-controller/controller-context'

function requirePolicy(store: AxiomStore, missionId: string) {
  const policy = store.getPolicy(missionId)
  if (!store.getMission(missionId) || !policy) {
    throw new MissionControllerError('mission_not_found', { missionId })
  }
  return policy
}

export const AXIOM_POLICY_METHODS = [
  defineMethod({
    name: 'axiom.policy.show',
    permission: 'workspace',
    params: PolicyShowParams,
    handler: (p, { runtime }) => ({
      policy: requirePolicy(getAxiomControlPlane(runtime).store, p.missionId)
    })
  }),
  defineMethod({
    name: 'axiom.policy.update',
    permission: 'workspace',
    params: PolicyUpdateParams,
    handler: (p, { runtime }) => {
      if (Object.hasOwn(p.patch, 'budget')) {
        throw Object.assign(new Error('Budget updates require Approval (M4)'), {
          code: 'approval_required'
        })
      }
      const { store } = getAxiomControlPlane(runtime)
      return store.transaction('policy_update', () => {
        const before = requirePolicy(store, p.missionId)
        const policy = {
          ...before,
          ...(p.patch.routing === undefined ? {} : { routing: p.patch.routing }),
          ...(p.patch.concurrencyLimit === undefined
            ? {}
            : { concurrencyLimit: p.patch.concurrencyLimit })
        }
        store.upsertPolicy(p.missionId, policy)
        store.appendAuditEvent({
          missionId: p.missionId,
          actor: 'user',
          objectKind: 'policy',
          objectId: p.missionId,
          event: 'policy.updated',
          before,
          after: policy
        })
        return { policy }
      })
    }
  })
]
