import type { z } from 'zod'
import type { PolicyUpdateParams } from '../../../shared/axiom-contract/policy-params'
import type { AxiomStore } from '../db/axiom-store'
import { MissionControllerError, type ControllerContext } from './controller-context'
import { assertSupportedReadinessThreshold } from './policy-readiness'

export function requirePolicy(store: AxiomStore, missionId: string) {
  const policy = store.getPolicy(missionId)
  if (!store.getMission(missionId) || !policy) {
    throw new MissionControllerError('mission_not_found', { missionId })
  }
  return policy
}

export function updatePolicy(ctx: ControllerContext, p: z.output<typeof PolicyUpdateParams>) {
  assertSupportedReadinessThreshold(p.patch.readinessThreshold)
  if (Object.hasOwn(p.patch, 'budget')) {
    throw Object.assign(new Error('Budget updates require Approval (M4)'), {
      code: 'approval_required'
    })
  }
  const { store } = ctx
  const before = requirePolicy(store, p.missionId)
  const policy = {
    ...before,
    ...(p.patch.readinessThreshold === undefined
      ? {}
      : { readinessThreshold: p.patch.readinessThreshold }),
    ...(p.patch.routing === undefined ? {} : { routing: p.patch.routing }),
    ...(p.patch.verificationRules === undefined
      ? {}
      : { verificationRules: p.patch.verificationRules }),
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
}
