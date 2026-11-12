import { z } from 'zod'
import type { AxiomStore } from '../db/axiom-store'
import { exposeUtcTimestamp } from '../../runtime/orchestration/db/utc-timestamp'
import type { OrchestrationDb } from '../../runtime/orchestration/db'

export const CodexThreadId = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/)
export const ResumedSessionSchema = z.object({
  strategy: z.literal('resumed_in_place'),
  id: CodexThreadId,
  originSeq: z.number().int().positive(),
  fromSeq: z.number().int().positive()
})
export type ResumedSession = z.infer<typeof ResumedSessionSchema>

export function readAttemptSession(store: AxiomStore, missionId: string, dispatchId: string) {
  const audit = store
    .listAuditEvents({ missionId })
    .findLast(
      (event) => event.objectId === dispatchId && event.event === 'attempt.headless_prepared'
    )
  const parsed = z.object({ session: ResumedSessionSchema }).safeParse(audit?.after)
  return parsed.success ? parsed.data.session : undefined
}

/** The first event is authoritative even if its id is malformed. */
export function firstThreadStarted(text: string): { started: boolean; id?: string } {
  for (const line of text.split(/\r?\n/)) {
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    const event = z
      .object({ type: z.literal('thread.started'), thread_id: z.unknown().optional() })
      .safeParse(value)
    if (event.success) {
      const id = CodexThreadId.safeParse(event.data.thread_id)
      return { started: true, ...(id.success ? { id: id.data } : {}) }
    }
  }
  return { started: false }
}

export function resumedExitEvidence(
  session: ResumedSession | undefined,
  eventsText: string
): Record<string, boolean | 'session'> {
  if (!session) {
    return {}
  }
  return {
    sessionContinued: firstThreadStarted(eventsText).id === session.id,
    usageScope: 'session' as const
  }
}

export function sessionOriginStartedAt(
  db: OrchestrationDb,
  store: AxiomStore,
  binding: { taskId: string; dispatchId: string | null; missionId: string },
  session = binding.dispatchId
    ? readAttemptSession(store, binding.missionId, binding.dispatchId)
    : undefined
) {
  const id = session
    ? store.getAttemptBinding(binding.taskId, session.originSeq)?.dispatchId
    : binding.dispatchId
  return Date.parse(
    exposeUtcTimestamp(id ? (db.getWorkerDispatch(id)?.created_at ?? null) : null) ?? ''
  )
}
