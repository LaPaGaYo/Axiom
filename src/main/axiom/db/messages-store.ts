import { z } from 'zod'
import {
  MessageListParams,
  parseAxiomMessagePayload
} from '../../../shared/axiom-contract/message-params'
import type { OrchestrationDb } from '../../runtime/orchestration/db'

const Row = z.object({
  id: z.string(),
  payload: z.string().nullable(),
  created_at: z.string(),
  resolved: z.number()
})
export function messagesStore(db: OrchestrationDb) {
  return {
    listMessages(input: z.input<typeof MessageListParams>) {
      const p = MessageListParams.parse(input)
      const rows = db.db
        .prepare(`SELECT m.id, m.payload, m.created_at,
        EXISTS(SELECT 1 FROM audit_events a WHERE a.mission_id = missions.id
          AND a.event = 'subtask.resolved' AND a.object_kind = 'message' AND a.object_id = m.id) AS resolved
        FROM messages m JOIN missions ON missions.run_id = m.run_id
        WHERE missions.id = ? ORDER BY m.sequence`)
        .all(p.missionId)
      return rows.flatMap((raw) => {
        const row = Row.parse(raw)
        const payload = parseAxiomMessagePayload(row.payload)
        if (!payload || payload.axiom.missionId !== p.missionId) {
          return []
        }
        const { type, taskId, attemptId, summary, artifactIds, related, subtask } = payload.axiom
        const pending = type === 'REQUEST_SUBTASK' && row.resolved === 0
        if (
          (p.type && p.type !== type) ||
          (p.taskId && p.taskId !== taskId) ||
          (p.attemptId && p.attemptId !== attemptId) ||
          (p.pendingOnly && !pending)
        ) {
          return []
        }
        return [
          {
            id: row.id,
            type,
            taskId,
            attemptId,
            summary,
            artifactIds,
            related,
            ...(subtask ? { subtask } : {}),
            createdAt: row.created_at,
            pending
          }
        ]
      })
    }
  }
}
