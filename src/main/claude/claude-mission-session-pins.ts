import type { Options } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeMissionSessionPins = {
  settingsPath: string
  accountHomePath: string
  skills: readonly string[]
  model?: string
  effort: NonNullable<Options['effort']>
  env: Readonly<Record<string, string>>
  denyPermission: (toolName: string) => void
}

const bySession = new Map<string, ClaudeMissionSessionPins>()
const byDispatch = new Map<string, string>()

/** Kernel extension point for caller-owned invocation policy. Mission sessions never resume after a process
 * restart: recovery settles their old dispatch, so these pins deliberately are not durable. */
export function registerClaudeMissionSessionPins(
  dispatchId: string,
  sessionId: string,
  pins: ClaudeMissionSessionPins
): () => void {
  if (bySession.has(sessionId) || byDispatch.has(dispatchId)) {
    throw new Error('Claude Planner launch policy already registered')
  }
  const entry = Object.freeze({
    ...pins,
    skills: Object.freeze([...pins.skills]),
    env: Object.freeze({ ...pins.env })
  })
  bySession.set(sessionId, entry)
  byDispatch.set(dispatchId, sessionId)
  return () => {
    if (bySession.get(sessionId) === entry) {
      bySession.delete(sessionId)
      byDispatch.delete(dispatchId)
    }
  }
}

export function claudeMissionSessionPins(sessionId: string): ClaudeMissionSessionPins | undefined {
  return bySession.get(sessionId)
}
