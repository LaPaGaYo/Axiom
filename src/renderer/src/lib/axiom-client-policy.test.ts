import { afterEach, expect, it, vi } from 'vitest'
import { axiomClient } from './axiom-client'
import { policy } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicyResponseSchema } from '../../../shared/axiom-contract/policy-params'
import { ORCHESTRATION_CONTRACT_VERSION } from '../../../shared/protocol-version'

afterEach(() => vi.unstubAllGlobals())

it('sends a policy update as a mutation with its request id', async () => {
  const call = vi.fn().mockResolvedValue({
    id: 'desktop-ipc',
    ok: true,
    result: { policy },
    _meta: { runtimeId: 'r' }
  })
  vi.stubGlobal('window', { api: { runtime: { call } } })
  const params = { missionId: 'mission-1', patch: { concurrencyLimit: 5 } }
  expect(await axiomClient.updatePolicy(params, 'policy-receipt')).toEqual(
    PolicyResponseSchema.parse({ policy })
  )
  expect(call).toHaveBeenCalledExactlyOnceWith({
    method: 'axiom.policy.update',
    params,
    envelope: {
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: 'policy-receipt'
    }
  })
  call.mockClear()
  await expect(
    axiomClient.updatePolicy({ ...params, missionId: '' }, 'bad-receipt')
  ).rejects.toMatchObject({ code: 'invalid_params' })
  expect(call).not.toHaveBeenCalled()
  await axiomClient.updatePolicy(params)
  expect(call).toHaveBeenCalledExactlyOnceWith({
    method: 'axiom.policy.update',
    params,
    envelope: {
      orchestrationContractVersion: ORCHESTRATION_CONTRACT_VERSION,
      orchestrationRequestId: expect.any(String)
    }
  })
  call.mockResolvedValue({
    id: 'desktop-ipc',
    ok: true,
    result: { policy: 'invalid' },
    _meta: { runtimeId: 'r' }
  })
  await expect(axiomClient.updatePolicy(params, 'invalid-answer')).rejects.toMatchObject({
    code: 'invalid_response'
  })
})
