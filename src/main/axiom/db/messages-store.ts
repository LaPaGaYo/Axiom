import { z } from 'zod'
import {
  MessageListParams,
  MessageSummaryResponseSchema,
  parseAxiomMessagePayload
} from '../../../shared/axiom-contract/message-params'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import { projectQuestion } from '../messaging/question-projection'
import { AxiomIdSchema } from '../../../shared/axiom-contract/mission-objects'

// Legacy kernel mail may have an absent or non-JSON payload.
const payloadJson = "CASE WHEN json_valid(m.payload) THEN m.payload ELSE '{}' END"
const typedQuestion = `json_extract(${payloadJson}, '$.axiom.type') = 'QUESTION'
  AND json_extract(${payloadJson}, '$.axiom.missionId') = missions.id
  AND json_extract(${payloadJson}, '$.axiom.taskId') = ?
  AND json_type(${payloadJson}, '$.axiom.question.text') = 'text'`
const AnsweredQuestion = z.object({
  question: z.string(),
  answer: z.string(),
  seq: z.number().int().positive()
})

const Row = z.object({
  id: z.string(),
  payload: z.string().nullable(),
  created_at: z.string(),
  resolved: z.number(),
  answer: z.string().nullable()
})
export function messagesStore(db: OrchestrationDb) {
  return {
    hasPendingTypedQuestionForTask(taskId: string): boolean {
      return (
        db.db
          .prepare(`SELECT 1 FROM messages m JOIN missions ON missions.run_id = m.run_id
        WHERE ${typedQuestion}
          AND NOT EXISTS(SELECT 1 FROM audit_events a WHERE a.mission_id = missions.id
            AND a.object_kind = 'message' AND a.object_id = m.id AND a.event = 'question.answered')
        LIMIT 1`)
          .get(AxiomIdSchema.parse(taskId)) !== undefined
      )
    },
    listAnsweredQuestionsForTask(missionId: string, taskId: string) {
      return z.array(AnsweredQuestion).parse(
        db.db
          .prepare(`
        SELECT json_extract(${payloadJson}, '$.axiom.question.text') AS question,
          json_extract(a.after, '$.answer') AS answer, b.seq
        FROM messages m JOIN missions ON missions.run_id = m.run_id
        JOIN audit_events a ON a.mission_id = missions.id AND a.object_kind = 'message'
          AND a.object_id = m.id AND a.event = 'question.answered'
        JOIN attempt_bindings b ON b.dispatch_id = json_extract(${payloadJson}, '$.axiom.attemptId')
          AND b.mission_id = missions.id AND b.task_id = json_extract(${payloadJson}, '$.axiom.taskId')
        WHERE ${typedQuestion} AND missions.id = ?
          AND json_extract(a.after, '$.taskId') = b.task_id
          AND json_extract(a.after, '$.attemptId') = b.dispatch_id
          AND json_type(a.after, '$.answer') = 'text'
        ORDER BY a.sequence DESC LIMIT 10`)
          .all(AxiomIdSchema.parse(taskId), AxiomIdSchema.parse(missionId))
      )
    },
    listMessages(input: z.input<typeof MessageListParams>) {
      const p = MessageListParams.parse(input)
      const rows = db.db
        .prepare(`SELECT m.id, m.payload, m.created_at,
        EXISTS(SELECT 1 FROM audit_events a WHERE a.mission_id = missions.id
          AND a.event IN ('subtask.resolved', 'blocked.resolved', 'question.answered', 'followup.resolved')
          AND a.object_kind = 'message' AND a.object_id = m.id) AS resolved,
        (SELECT json_extract(a.after, '$.answer') FROM audit_events a
          WHERE a.mission_id = missions.id AND a.event = 'question.answered'
            AND a.object_kind = 'message' AND a.object_id = m.id
          ORDER BY a.sequence DESC LIMIT 1) AS answer
        FROM messages m JOIN missions ON missions.run_id = m.run_id
        WHERE missions.id = ? ORDER BY m.sequence`)
        .all(p.missionId)
      return rows.flatMap((raw) => {
        const row = Row.parse(raw)
        const payload = parseAxiomMessagePayload(row.payload)
        const projected =
          payload?.axiom.missionId === p.missionId ? payload.axiom : projectQuestion(db, row.id)
        if (!projected) {
          return []
        }
        const { type, taskId, attemptId, summary, artifactIds, related } = projected
        const pending =
          'pending' in projected
            ? projected.pending
            : (type === 'REQUEST_SUBTASK' ||
                (type === 'BLOCKED' && projected.blocked !== undefined) ||
                projected.question !== undefined ||
                projected.followUp !== undefined) &&
              row.resolved === 0
        if (
          (p.type && p.type !== type) ||
          (p.taskId && p.taskId !== taskId) ||
          (p.attemptId && p.attemptId !== attemptId) ||
          (p.pendingOnly && !pending)
        ) {
          return []
        }
        return [
          MessageSummaryResponseSchema.parse({
            ...projected,
            ...(!('pending' in projected) && projected.question
              ? {
                  question: projected.question.text,
                  options: projected.question.options,
                  answer: row.answer,
                  status: pending ? 'pending' : 'answered'
                }
              : {}),
            id: row.id,
            type,
            taskId,
            attemptId,
            summary,
            artifactIds,
            related,
            createdAt: row.created_at,
            pending
          })
        ]
      })
    }
  }
}
