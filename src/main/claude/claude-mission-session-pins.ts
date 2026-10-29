import type { Options, McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk'

export type ClaudeMissionTurnSettlement = {
  outcome: 'success' | 'failure' | 'cancellation' | 'unknown'
  isError: boolean
  numTurns: number | null
}

export type ClaudeMissionSessionPins = {
  settingsPath: string
  accountHomePath: string
  skills: readonly string[]
  model?: string
  effort: NonNullable<Options['effort']>
  env: Readonly<Record<string, string>>
  managedSettings: Readonly<Record<string, unknown>>
  mcpServers: Readonly<Record<string, McpStdioServerConfig>>
  onTurnSettled?: (settlement: ClaudeMissionTurnSettlement) => void
  denyPermission: (toolName: string, input?: unknown) => void
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
    managedSettings: Object.freeze({ ...pins.managedSettings }),
    env: Object.freeze({ ...pins.env }),
    mcpServers: Object.freeze(
      Object.fromEntries(
        Object.entries(pins.mcpServers).map(([name, server]) => {
          const args = server.args ? [...server.args] : undefined
          if (args) {
            Object.freeze(args)
          }
          return [
            name,
            Object.freeze({
              ...server,
              ...(args ? { args } : {}),
              ...(server.env ? { env: Object.freeze({ ...server.env }) } : {})
            })
          ]
        })
      )
    )
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
