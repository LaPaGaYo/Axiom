import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from './client'
import { sendRequest } from './transport'
import { readMetadata } from './metadata'
import { AXIOM_MUTATION_METHODS } from '../../shared/axiom-contract/mutations'

vi.mock('./metadata', () => ({ readMetadata: vi.fn(), getDefaultUserDataPath: () => '/test' }))
vi.mock('./transport', () => ({ sendRequest: vi.fn() }))
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
})

it.each(AXIOM_MUTATION_METHODS)(
  'stamps %s and reuses the durable request id without session evidence',
  async (method) => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', 'user-session')
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
    await client.call(method, { example: true }, { orchestrationRequestId: 'same-id' })
    const envelope = vi.mocked(sendRequest).mock.calls.at(-1)?.[4]
    expect(envelope).toMatchObject({
      orchestrationContractVersion: 1,
      orchestrationRequestId: 'same-id'
    })
    expect(envelope).not.toHaveProperty('orchestrationCompatibilityEvidence')
    expect(envelope).not.toHaveProperty('compatibilityInvocationId')
  }
)
