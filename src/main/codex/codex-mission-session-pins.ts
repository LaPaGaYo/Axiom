export type CodexMissionSessionPins = {
  env: Readonly<Record<string, string>>
}

const bySession = new Map<string, CodexMissionSessionPins>()
const byDispatch = new Map<string, string>()

/** Caller-owned invocation policy, like Claude's registry. Mission sessions are settled by
 * recovery after restart rather than resumed, so pins deliberately remain process-local. */
export function registerCodexMissionSessionPins(
  dispatchId: string,
  sessionId: string,
  pins: CodexMissionSessionPins
): () => void {
  if (bySession.has(sessionId) || byDispatch.has(dispatchId)) {
    throw new Error('Codex Planner launch policy already registered')
  }
  const entry = Object.freeze({ ...pins, env: Object.freeze({ ...pins.env }) })
  bySession.set(sessionId, entry)
  byDispatch.set(dispatchId, sessionId)
  return () => {
    if (bySession.get(sessionId) === entry) {
      bySession.delete(sessionId)
      byDispatch.delete(dispatchId)
    }
  }
}

export function codexMissionSessionPins(sessionId: string): CodexMissionSessionPins | undefined {
  return bySession.get(sessionId)
}
