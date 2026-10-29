import { PassThrough } from 'node:stream'
import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { RuntimeClient, RuntimeClientError } from '../../runtime-client'
import { makeProposal } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { createAttemptMcpServer, serveAttemptMcp } from './attempt-mcp'

const cleanup: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((close) => close()))
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
async function fixture() {
  vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term_planner')
  const runtime = new RuntimeClient('/unused', 500, null, null)
  const call = vi.spyOn(runtime, 'call')
  const ctx = {
    client: runtime,
    cwd: '/fixture',
    json: false,
    flags: new Map([
      ['mission', 'mission_1'],
      ['attempt', 'attempt_1']
    ])
  }
  const server = createAttemptMcpServer(ctx, '1.2.3')
  const client = new Client({ name: 'test', version: '1' })
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair()
  cleanup.push(async () => {
    await client.close()
    await server.close()
  })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  const { provenance: _provenance, ...proposal } = makeProposal()
  return { server, client, call, proposal, ctx }
}
it('advertises the real Planner proposal schema and maps the host receipt without stdout noise', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const { client, call, proposal } = await fixture()
  call.mockResolvedValue({
    id: 'rpc',
    ok: true,
    _meta: { runtimeId: 'test' },
    result: {
      planRevision: {
        id: 'plan_1',
        status: 'PROPOSED',
        tasks: proposal.tasks,
        edges: proposal.edges
      }
    }
  })
  const listing = await client.listTools()
  expect(listing.tools).toHaveLength(1)
  expect(listing.tools[0]).toMatchObject({
    name: 'plan_propose',
    inputSchema: { required: ['proposal'] }
  })
  const result = await client.callTool({ name: 'plan_propose', arguments: { proposal } })
  expect(result).toEqual({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: true,
          planRevisionId: 'plan_1',
          status: 'PROPOSED',
          taskCount: proposal.tasks.length,
          edgeCount: proposal.edges.length
        })
      }
    ]
  })
  expect(call).toHaveBeenCalledExactlyOnceWith('axiom.plan.propose', {
    missionId: 'mission_1',
    attemptId: 'attempt_1',
    from: 'term_planner',
    planRevision: proposal
  })
  expect(log).not.toHaveBeenCalled()
})
it.each([
  [
    'invalid_argument',
    'Invalid proposal',
    { issues: [{ path: ['tasks'], message: 'invalid task' }] }
  ],
  ['runtime_unavailable', 'Runtime unavailable', undefined]
])('returns a JSON tool error for %s and preserves RPC issues', async (code, message, data) => {
  const { client, call, proposal } = await fixture()
  call.mockRejectedValue(new RuntimeClientError(code, message, data))
  expect(await client.callTool({ name: 'plan_propose', arguments: { proposal } })).toEqual({
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: {
            code,
            message,
            ...data
          }
        })
      }
    ]
  })
})
it('ends the stdio server when stdin closes without emitting non-protocol output', async () => {
  const { ctx } = await fixture()
  const stdin = new PassThrough(),
    stdout = new PassThrough()
  const chunks: Buffer[] = []
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  const running = serveAttemptMcp(ctx, { stdin, stdout, version: '1.2.3' })
  stdin.end()
  await running
  expect(Buffer.concat(chunks).toString()).toBe('')
})
it('sends malformed proposals to the single host validator and returns JSON schema issues', async () => {
  const { client, call } = await fixture()
  const issues = [{ path: ['goalRevisionId'], message: 'Required' }]
  call.mockRejectedValue(new RuntimeClientError('invalid_params', 'Invalid proposal', { issues }))
  expect(await client.callTool({ name: 'plan_propose', arguments: { proposal: {} } })).toEqual({
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: { code: 'invalid_params', message: 'Invalid proposal', issues }
        })
      }
    ]
  })
  expect(call).toHaveBeenCalledWith('axiom.plan.propose', {
    missionId: 'mission_1',
    attemptId: 'attempt_1',
    from: 'term_planner',
    planRevision: {}
  })
})
it('returns semantic validation errors as issues without losing the host details', async () => {
  const { client, call, proposal } = await fixture()
  const issues = [{ code: 'cycle', severity: 'error', message: 'Cycle', taskIds: ['t1', 't2'] }]
  call.mockRejectedValue(new RuntimeClientError('plan_invalid', 'plan_invalid', { errors: issues }))
  expect(await client.callTool({ name: 'plan_propose', arguments: { proposal } })).toEqual({
    isError: true,
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          ok: false,
          error: { code: 'plan_invalid', message: 'plan_invalid', issues }
        })
      }
    ]
  })
})
