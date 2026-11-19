import { generateId } from '../../runtime/orchestration/db/generated-id'
import type { AxiomStore } from '../db/axiom-store'

// The caller owns the write transaction and supplies the controller clock.
export function requestDeliveryApproval(
  store: AxiomStore,
  missionId: string,
  reportSha256: string,
  now: string
) {
  revokeDeliveryApprovals(store, missionId, 'superseded', now)
  const approval = store.insertApproval({
    id: generateId('approval'),
    missionId,
    actionKind: 'delivery',
    inputsHash: reportSha256,
    risk: 'high',
    requestedBy: 'MissionController',
    expiresAt: new Date(new Date(now).getTime() + 72 * 60 * 60 * 1000).toISOString()
  })
  store.appendAuditEvent({
    missionId,
    actor: 'MissionController',
    objectKind: 'approval',
    objectId: approval.id,
    event: 'approval.requested',
    before: null,
    after: {
      id: approval.id,
      actionKind: approval.actionKind,
      inputsHash: approval.inputsHash,
      expiresAt: approval.expiresAt
    },
    createdAt: now
  })
  return approval
}

export function revokeDeliveryApprovals(
  store: AxiomStore,
  missionId: string,
  reason: string,
  now: string
): void {
  for (const approval of store.listApprovals({ missionId, actionKind: 'delivery' })) {
    // GRANTED has one way out, CONSUMED (AGENTS.md), so only a PENDING request is withdrawn.
    if (approval.status !== 'PENDING') {
      continue
    }
    if (
      !store.transitionApproval({
        id: approval.id,
        expectedStatus: approval.status,
        status: 'REVOKED',
        resolver: 'MissionController',
        resolution: reason
      })
    ) {
      continue
    }
    store.appendAuditEvent({
      missionId,
      actor: 'MissionController',
      objectKind: 'approval',
      objectId: approval.id,
      event: 'approval.revoked',
      before: { status: approval.status },
      after: { id: approval.id, reason },
      createdAt: now
    })
  }
}

export function latestDeliveryApproval(store: AxiomStore, missionId: string) {
  return store.listApprovals({ missionId, actionKind: 'delivery' }).at(-1)
}
