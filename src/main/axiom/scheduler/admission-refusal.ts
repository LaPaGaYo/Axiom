import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { AxiomStore } from '../db/axiom-store'

export function admissionRefusalRecorded(
  store: AxiomStore,
  missionId: string,
  taskId: string,
  data: AuditEvent['after']
): boolean {
  const refusal = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'task',
    objectId: taskId,
    events: ['task.admission_refused']
  })
  const stage = store.getLatestReadModelAudit({
    missionId,
    objectKind: 'task',
    objectId: taskId,
    events: ['task.stage']
  })
  // Match the read models so skipping a repeat preserves their since and until values.
  return (
    !!refusal &&
    refusal.sequence > (stage?.sequence ?? 0) &&
    JSON.stringify(refusal.after) === JSON.stringify(data)
  )
}
