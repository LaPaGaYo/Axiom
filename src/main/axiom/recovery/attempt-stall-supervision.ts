import { statSync } from 'node:fs'
import path from 'node:path'
import { headlessAttemptDirectory } from '../execution/headless-attempt-files'
import { effectiveStallMode } from '../supervision/supervision-settings'
import { auditAttempt, type AttemptBinding, type RecoveryContext } from './attempt-recovery-effects'
import { sampleAttemptCadence } from './attempt-cadence'
import { stallThresholdForPass } from './supervision-policy'
import type { StallStopFacts } from './supervision-stop-settlement'

function lastEventTime(attemptId: string): number | undefined {
  try {
    const file = statSync(path.join(headlessAttemptDirectory(attemptId), 'events.jsonl'))
    return file.isFile() && Number.isFinite(file.mtimeMs) ? file.mtimeMs : undefined
  } catch {
    // Missing or unreadable metadata skips this sample without delaying the runtime limit.
    return undefined
  }
}

export function superviseStall(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  startedAt: number
): StallStopFacts | undefined {
  if (!binding.dispatchId) {
    return
  }
  const lastEventAt = lastEventTime(binding.dispatchId)
  if (lastEventAt === undefined) {
    return
  }
  const now = ctx.now()
  const idleMs = Math.max(0, now - lastEventAt)
  sampleAttemptCadence(ctx, binding, startedAt, now, idleMs)
  let mode
  try {
    mode = effectiveStallMode(ctx.store, binding.missionId)
  } catch {
    // A settings read failure disables only this heuristic for this pass, never timeout.
    return
  }
  if (mode !== 'stop') {
    const observed = ctx.db.db
      .prepare(`SELECT 1 FROM audit_events
      WHERE mission_id = ? AND object_kind = 'attempt' AND object_id = ?
      AND event = 'attempt.supervised' AND json_extract(after, '$.rule') = 'stalled'
      AND json_extract(after, '$.mode') = ? LIMIT 1`)
      .get(binding.missionId, binding.dispatchId, mode)
    if (observed !== undefined) {
      return
    }
  }
  const threshold = stallThresholdForPass(ctx)
  if (idleMs <= threshold.thresholdMs) {
    return
  }
  const facts = { ...threshold, idleMs, lastEventAt: new Date(lastEventAt).toISOString() }
  if (mode === 'stop') {
    return { rule: 'stalled', mode, ...facts }
  }
  auditAttempt(ctx, binding, 'attempt.supervised', {
    rule: 'stalled',
    mode,
    ...facts,
    wouldActAt: new Date(lastEventAt + threshold.thresholdMs).toISOString()
  })
  return undefined
}
