import type { AxiomStore } from '../db/axiom-store'

export function resumeDeliveryApprovalClock(store: AxiomStore, missionId: string) {
  const paused = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'mission',
    objectId: missionId,
    events: ['mission.status'],
    status: 'PAUSED'
  })
  const resumed = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'mission',
    objectId: missionId,
    events: ['mission.status']
  })
  if (!paused || !resumed) {
    return
  }
  // Both interval boundaries use persisted controller timestamps, without a second clock read.
  const now = resumed.createdAt
  // An unblock into PAUSED starts a new interval; time in BLOCKED is excluded.
  const pausedMs = Date.parse(now) - Date.parse(paused.createdAt)
  for (const approval of store.listApprovals({ missionId, actionKind: 'delivery' })) {
    if (approval.status !== 'PENDING' && approval.status !== 'GRANTED') {
      continue
    }
    const expiresAt = new Date(Date.parse(approval.expiresAt) + pausedMs).toISOString()
    if (!store.updateApprovalExpiry({ id: approval.id, expiresAt })) {
      continue
    }
    store.appendAuditEvent({
      missionId,
      actor: 'MissionController',
      objectKind: 'approval',
      objectId: approval.id,
      event: 'approval.clock_resumed',
      before: { expiresAt: approval.expiresAt },
      after: { id: approval.id, expiresAt, pausedMs },
      createdAt: now
    })
  }
}
