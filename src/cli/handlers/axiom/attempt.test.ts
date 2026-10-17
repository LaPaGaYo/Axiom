import { describe, expect, it } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'

describe('Axiom attempt CLI registration', () => {
  it.each([
    { verb: 'show', flags: ['--attempt', 'dispatch_123'] },
    { verb: 'list', flags: ['--mission', 'mission_123'] },
    { verb: 'list', flags: ['--mission', 'mission_123', '--task', 'task_123'] }
  ])('accepts attempt $verb through the public command catalog ($flags)', ({ verb, flags }) => {
    const parsed = parseArgs(
      ['attempt', verb, ...flags, '--json'],
      COMMAND_SPECS.map((spec) => spec.path),
      COMMAND_SPECS
    )
    expect(() => validateCommandAndFlags(COMMAND_SPECS, parsed)).not.toThrow()
    expect(parsed.commandPath).toEqual(['attempt', verb])
    expect(parsed.flags.get('json')).toBe(true)
  })
})

it.each([
  { args: ['show', '--attempt', 'd1'], method: 'axiom.attempt.show', params: { attemptId: 'd1' } },
  {
    args: ['list', '--mission', 'm1', '--task', 't1'],
    method: 'axiom.attempt.list',
    params: { missionId: 'm1', taskId: 't1' }
  }
])('dispatches $method through its registered handler', async ({ args, method, params }) => {
  const { RuntimeClient } = await import('../../runtime-client.js')
  const { dispatch } = await import('../../dispatch.js')
  const { vi } = await import('vitest')
  const client = new RuntimeClient('/unused', 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'runtime' } })
  const output = vi.spyOn(console, 'log').mockImplementation(() => {})
  try {
    const parsed = parseArgs(
      ['attempt', ...args, '--json'],
      COMMAND_SPECS.map((s) => s.path),
      COMMAND_SPECS
    )
    await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/unused', json: true })
    expect(call).toHaveBeenCalledExactlyOnceWith(method, params, {
      orchestrationRequestId: undefined
    })
  } finally {
    output.mockRestore()
    call.mockRestore()
  }
})
