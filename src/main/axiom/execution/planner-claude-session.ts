import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'

export type ClaudePlannerSessionPins = {
  settingsPath: string
  accountHomePath: string
  skills: readonly string[]
  model?: string
  effort: AgentSpec['reasoning']['effort']
  denyPermission: (toolName: string) => void
}

const bySession = new Map<string, ClaudePlannerSessionPins>()
const byDispatch = new Map<string, string>()

/** Control Plane-owned invocation policy. Mission sessions are never resumed after a process
 * restart: recovery settles their old dispatch, so these pins deliberately are not durable. */
export function registerClaudePlannerSession(
  dispatchId: string,
  sessionId: string,
  pins: ClaudePlannerSessionPins
): () => void {
  if (bySession.has(sessionId) || byDispatch.has(dispatchId)) {
    throw new Error('Claude Planner launch policy already registered')
  }
  const entry = Object.freeze({ ...pins, skills: Object.freeze([...pins.skills]) })
  bySession.set(sessionId, entry)
  byDispatch.set(dispatchId, sessionId)
  return () => {
    if (bySession.get(sessionId) === entry) {
      bySession.delete(sessionId)
      byDispatch.delete(dispatchId)
    }
  }
}

export function claudePlannerSessionPins(sessionId: string): ClaudePlannerSessionPins | undefined {
  return bySession.get(sessionId)
}
