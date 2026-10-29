import type { Readable, Writable } from 'node:stream'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { CallToolRequestSchema, type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { HandlerContext } from '../../dispatch'
import { getRequiredStringFlag as required } from '../../flags'
import { readOrcaCliVersion } from '../../cli-version'
import { RuntimeClientError } from '../../runtime-client'
import { PlanProposalSchema } from '../../../shared/axiom-contract/plan-proposal'
import type { PlanResponse } from '../../../shared/axiom-contract/plan-params'
import { callOrchestrationMutation } from '../orchestration/mutation-request'
import { resolveOrchestrationTerminalHandle } from '../orchestration/terminal-identity'

export function createAttemptMcpServer(ctx: HandlerContext, version: string): McpServer {
  const missionId = required(ctx.flags, 'mission')
  const attemptId = required(ctx.flags, 'attempt')
  const server = new McpServer({ name: 'axiom', version })
  const submit = async (proposal: unknown): Promise<CallToolResult> => {
    try {
      const from = await resolveOrchestrationTerminalHandle(ctx.flags, ctx.cwd, ctx.client, 'from')
      const {
        result: { planRevision }
      } = await callOrchestrationMutation<PlanResponse>(
        ctx.client,
        ctx.flags,
        'axiom.plan.propose',
        { missionId, planRevision: proposal, attemptId, from }
      )
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: true,
              planRevisionId: planRevision.id,
              status: planRevision.status,
              taskCount: planRevision.tasks.length,
              edgeCount: planRevision.edges.length
            })
          }
        ]
      }
    } catch (error) {
      const data = error instanceof RuntimeClientError ? error.data : undefined
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              ok: false,
              error: {
                code: error instanceof RuntimeClientError ? error.code : 'internal_error',
                message: error instanceof Error ? error.message : 'Planner proposal failed.',
                ...(data && typeof data === 'object'
                  ? 'issues' in data
                    ? { issues: data.issues }
                    : 'errors' in data
                      ? { issues: data.errors }
                      : {}
                  : {})
              }
            })
          }
        ]
      }
    }
  }
  server.registerTool(
    'plan_propose',
    {
      description:
        'Submit this Planner Attempt’s complete PlanProposal to the Control Plane. Fix any returned issues and call again.',
      // The authenticated host stamps provenance, exactly as for plan propose --attempt.
      inputSchema: { proposal: PlanProposalSchema.omit({ provenance: true }) }
    },
    ({ proposal }) => submit(proposal)
  )
  // Advertise the real schema but let the existing RPC validate every proposal, including
  // malformed input. SDK-local validation would return unstructured text before our callback.
  server.server.setRequestHandler(CallToolRequestSchema, (request) =>
    request.params.name === 'plan_propose'
      ? submit(request.params.arguments?.proposal)
      : Promise.resolve({
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ok: false,
                error: { code: 'tool_not_found', message: 'Unknown Axiom MCP tool.' }
              })
            }
          ]
        })
  )
  return server
}

export async function serveAttemptMcp(
  ctx: HandlerContext,
  io: { stdin: Readable; stdout: Writable; version: string | null } = {
    stdin: process.stdin,
    stdout: process.stdout,
    version: readOrcaCliVersion()
  }
): Promise<void> {
  let server: McpServer | undefined
  // The transport detaches its listeners on close; it does not own stdin's EOF.
  // RuntimeClient opens/closes a socket per RPC, so no persistent runtime connection survives.
  try {
    if (!io.version) {
      throw new Error('CLI version unavailable')
    }
    server = createAttemptMcpServer(ctx, io.version)
    const transport = new StdioServerTransport(io.stdin, io.stdout)
    const connectedServer = server
    await new Promise<void>((resolve, reject) => {
      io.stdin.once('end', resolve)
      io.stdin.once('error', reject)
      void connectedServer.connect(transport).catch(reject)
    })
  } catch {
    // Stdio belongs exclusively to MCP, including when --json was supplied.
    process.stderr.write('Axiom Attempt MCP server failed.\n')
    process.exitCode = 1
  } finally {
    await server?.close()
  }
}

/** EOF is the command's lifetime boundary even if a per-request runtime socket is pending. */
export async function runAttemptMcp(ctx: HandlerContext): Promise<void> {
  await serveAttemptMcp(ctx)
  process.exit(process.exitCode ?? 0)
}
