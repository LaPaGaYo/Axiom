import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import Database from '../../../src/main/sqlite/sync-database'
import {
  CandidateRowCodec,
  SubmissionRowCodec,
  VerificationRunRowCodec
} from '../../../src/main/axiom/db/submission-rows'

// Keep full persisted rows for rejection comparisons, alongside the submit spec's typed view.
export function inspectFixtureMission(userData: string, missionId: string) {
  const db = new Database(path.join(userData, 'orchestration.db'), {
    readonly: true,
    fileMustExist: true
  })
  try {
    db.exec('BEGIN')
    const rows = {
      bindings: db
        .prepare('SELECT * FROM attempt_bindings WHERE mission_id = ? ORDER BY task_id, seq')
        .all(missionId),
      tasks: db
        .prepare('SELECT * FROM task_stages WHERE mission_id = ? ORDER BY task_id')
        .all(missionId),
      candidates: db
        .prepare('SELECT * FROM candidates WHERE mission_id = ? ORDER BY task_id, id')
        .all(missionId),
      submissions: db
        .prepare('SELECT * FROM submissions WHERE mission_id = ? ORDER BY task_id, id')
        .all(missionId),
      verification: db
        .prepare('SELECT * FROM verification_runs WHERE mission_id = ? ORDER BY task_id, id')
        .all(missionId),
      dispatches: db
        .prepare(
          'SELECT d.* FROM dispatch_contexts d JOIN attempt_bindings b ON b.dispatch_id = d.id WHERE b.mission_id = ? ORDER BY d.id'
        )
        .all(missionId),
      workers: db
        .prepare(
          'SELECT w.*, d.retry_of_dispatch_id FROM worker_dispatches w JOIN attempt_bindings b ON b.dispatch_id = w.dispatch_id JOIN dispatch_contexts d ON d.id = w.dispatch_id WHERE b.mission_id = ? ORDER BY w.dispatch_id'
        )
        .all(missionId)
    }
    return {
      rows,
      bindings: z
        .array(
          z.object({
            task_id: z.string(),
            dispatch_id: z.string().nullable(),
            seq: z.number(),
            branch: z.string()
          })
        )
        .parse(rows.bindings),
      tasks: z
        .array(
          z.object({
            task_id: z.string(),
            stage: z.string(),
            attempt_count: z.number(),
            spec: z.string()
          })
        )
        .parse(rows.tasks),
      candidates: z.array(CandidateRowCodec).parse(rows.candidates),
      submissions: z.array(SubmissionRowCodec).parse(rows.submissions),
      // v45 codec exposes runtimeEpoch, claimCount, worktreeId and start/finish timestamps.
      verification: z.array(VerificationRunRowCodec).parse(rows.verification),
      dispatches: z
        .array(
          z.object({
            id: z.string(),
            status: z.string(),
            assignee_handle: z.string().nullable(),
            assignee_pane_key: z.string().nullable()
          })
        )
        .parse(rows.dispatches),
      workers: z
        .array(
          z.object({
            dispatch_id: z.string(),
            state: z.string(),
            retry_of_dispatch_id: z.string().nullable()
          })
        )
        .parse(rows.workers),
      audits: z
        .array(
          z.object({
            sequence: z.number(),
            event: z.string(),
            object_id: z.string(),
            after: z.string().nullable()
          })
        )
        .parse(
          db
            .prepare(
              'SELECT sequence, event, object_id, after FROM audit_events WHERE mission_id = ? ORDER BY sequence'
            )
            .all(missionId)
        )
    }
  } finally {
    db.close()
  }
}

const LedgerLine = z.object({
  kind: z.string().optional(),
  attemptId: z.string(),
  taskId: z.string().optional(),
  terminalHandle: z.string().optional(),
  paneKey: z.string().optional(),
  response: z.object({ ok: z.boolean() }).optional()
})
export function fixtureLedger(file: string) {
  return existsSync(file)
    ? readFileSync(file, 'utf8')
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => LedgerLine.parse(JSON.parse(line)))
    : []
}
