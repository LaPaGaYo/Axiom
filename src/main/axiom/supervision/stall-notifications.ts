import { z } from 'zod'
import {
  StallNotificationSchema,
  SupervisionShowParams
} from '../../../shared/axiom-contract/supervision'
import type { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'

export function listStallNotifications(db: OrchestrationDb, missionId?: string) {
  const scope = SupervisionShowParams.parse({ missionId })
  // Current means the same latest, unsubmitted RUNNING Task binding used by recovery.
  return z.array(StallNotificationSchema).parse(
    db.db
      .prepare(`SELECT
    a.mission_id AS missionId, b.task_id AS taskId, b.seq, b.dispatch_id AS attemptId,
    json_extract(a.after, '$.idleMs') AS idleMs,
    json_extract(a.after, '$.thresholdMs') AS thresholdMs,
    json_extract(a.after, '$.thresholdSource') AS thresholdSource,
    json_extract(a.after, '$.lastEventAt') AS lastEventAt, a.created_at AS notifiedAt
    FROM audit_events a
    JOIN attempt_bindings b ON b.dispatch_id = a.object_id AND b.mission_id = a.mission_id
    JOIN task_stages t ON t.task_id = b.task_id AND t.mission_id = b.mission_id
    WHERE a.event = 'attempt.supervised' AND a.object_kind = 'attempt'
      AND json_extract(a.after, '$.rule') = 'stalled'
      AND json_extract(a.after, '$.mode') = 'notify'
      AND (? IS NULL OR a.mission_id = ?) AND t.stage = 'RUNNING'
      AND NOT EXISTS (SELECT 1 FROM attempt_bindings newer WHERE newer.task_id = b.task_id AND newer.seq > b.seq)
      AND NOT EXISTS (SELECT 1 FROM submissions s WHERE s.dispatch_id = b.dispatch_id)
    ORDER BY a.created_at, a.sequence`)
      .all(scope.missionId ?? null, scope.missionId ?? null)
  )
}
