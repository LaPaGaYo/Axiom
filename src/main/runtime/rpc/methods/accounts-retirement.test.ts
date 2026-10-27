import { afterEach, expect, it, vi } from 'vitest'
import { ACCOUNT_METHODS } from './accounts'
import { eraseRpcMethods, isStreamingMethod } from '../core'
import type { OrcaRuntimeService } from '../../orca-runtime'
import { mapRuntimeError } from '../errors'
import {
  SelectAccountParams,
  SelectCodexAccountForTargetParams
} from '../../../../shared/rpc-contract/accounts-params'

afterEach(() => vi.restoreAllMocks())
it.each(['accounts.selectCodex', 'accounts.selectCodexForTarget'])(
  '%s preserves the null schema but refuses the retired lane',
  async (name) => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    expect(SelectAccountParams.parse({ accountId: null })).toEqual({ accountId: null })
    const params = SelectCodexAccountForTargetParams.parse({
      accountId: null,
      target: { runtime: 'host', wslDistro: null }
    })
    const method = eraseRpcMethods(ACCOUNT_METHODS).find((m) => m.name === name)!
    if (isStreamingMethod(method)) {
      throw new Error('Expected request')
    }
    const select = vi.fn()
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: rejection occurs before either runtime selection member is called.
    const runtime = {
      selectCodexAccount: select,
      selectCodexAccountForTarget: select
    } as unknown as OrcaRuntimeService
    await expect(method.handler(params, { runtime })).rejects.toMatchObject({
      code: 'system_default_retired'
    })
    expect(select).not.toHaveBeenCalled()
  }
)

it('preserves system_default_retired through the RPC transport', () => {
  // Scope blocker: ../errors.ts needs this code in its passthrough set (outside M3-08d scope).
  expect(
    mapRuntimeError(
      'r',
      { runtimeId: 'test' },
      Object.assign(new Error('system_default_retired'), { code: 'system_default_retired' })
    )
  ).toMatchObject({ error: { code: 'system_default_retired' } })
})
