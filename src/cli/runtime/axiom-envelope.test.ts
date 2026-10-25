import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from './client'
import { sendRequest } from './transport'
import { readMetadata } from './metadata'
import type * as Metadata from './metadata'
import { AXIOM_MUTATION_METHODS } from '../../shared/axiom-contract/mutations'

vi.mock('./metadata', async (importOriginal) => ({
  ...(await importOriginal<typeof Metadata>()),
  readMetadata: vi.fn(),
  getDefaultUserDataPath: () => '/test'
}))
vi.mock('./transport', () => ({ sendRequest: vi.fn() }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it.each(AXIOM_MUTATION_METHODS)(
  'stamps %s and reuses the durable request id with session evidence for attribution',
  async (method) => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', '4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37')
    vi.mocked(readMetadata).mockReturnValue({
      runtimeId: 'test',
      pid: process.pid,
      transports: [],
      authToken: 'test',
      startedAt: 0
    })
    vi.mocked(sendRequest).mockResolvedValue({
      id: 'rpc',
      ok: true,
      result: { capabilities: ['orchestration.contract.v1', 'axiom.control-plane.v1'] },
      _meta: { runtimeId: 'test' }
    })
    const client = new RuntimeClient('/test', 500, null, null)
    const params =
      method === 'axiom.artifact.put' || method === 'axiom.plan.propose'
        ? { attemptId: 'attempt-1' }
        : { example: true }
    await client.call(method, params, { orchestrationRequestId: 'same-id' })
    const envelope = vi.mocked(sendRequest).mock.calls.at(-1)?.[4]
    expect(envelope).toMatchObject({
      orchestrationContractVersion: 1,
      orchestrationRequestId: 'same-id'
    })
    expect(envelope).toMatchObject({
      orchestrationCompatibilityEvidence: {
        agentSessionId: '4a1f6c2e-8b3d-4e7a-9c15-0d2b6e8f1a37'
      },
      compatibilityInvocationId: 'same-id'
    })
  }
)
