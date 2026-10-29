import path from 'node:path'
import type { McpStdioServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { sealStructuredSessionChild } from '../../runtime/structured-session-child-env'

/** Use the kernel's own launcher and caller identity seal; commandEnv excludes the
 * spawn token (owned only by the provider child), PATH and all inherited values. */
export function plannerMcpServer(
  missionId: string,
  dispatchId: string,
  sessionId: string
): McpStdioServerConfig {
  const { commandEnv } = sealStructuredSessionChild({
    sessionId,
    spawnToken: '',
    env: {},
    inheritedEnvToDelete: []
  })
  const command = commandEnv.ORCA_CLI_COMMAND
  if (!command || !path.isAbsolute(command)) {
    throw new Error('cli_launcher_unavailable')
  }
  return {
    type: 'stdio',
    command,
    args: ['attempt', 'mcp', '--mission', missionId, '--attempt', dispatchId],
    env: commandEnv
  }
}
