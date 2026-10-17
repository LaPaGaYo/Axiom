import { afterEach, expect, it, vi } from 'vitest'
import { formatCliError, reportCliError } from './cli-error'
import { RuntimeRpcFailureError } from './runtime-client'

afterEach(() => vi.restoreAllMocks())

it.each(['mission_not_found', 'illegal_transition', 'plan_pending'])(
  'prints %s with its message and preserves JSON data',
  (code) => {
    const response = {
      id: 'rpc',
      ok: false as const,
      error: { code, message: 'Cannot apply command', data: { missionId: 'm1' } },
      _meta: { runtimeId: 'runtime' }
    }
    const error = new RuntimeRpcFailureError(response)
    expect(formatCliError(error, { commandPath: ['mission', 'start'] })).toBe(
      `${code}: Cannot apply command`
    )
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    reportCliError(error, true, { commandPath: ['mission', 'start'] })
    expect(JSON.parse(output.mock.calls[0][0])).toEqual(response)
  }
)
