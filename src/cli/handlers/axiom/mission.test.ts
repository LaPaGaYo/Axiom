import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../../runtime-client'
import { dispatch } from '../../dispatch'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { mission } from '../../../shared/axiom-contract/contract-fixtures.test-support'

afterEach(() => vi.restoreAllMocks())
it.each([true, false])('prints cancel settlement evidence (json=%s)', async (json) => {
  const parsed = parseArgs(
    ['mission', 'cancel', '--mission', mission.id, '--reason', 'user request'],
    COMMAND_SPECS.map((spec) => spec.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const client = new RuntimeClient('/tmp', 500, null, null)
  const attempts = [
    { attemptId: 'dispatch-live', taskId: 'task-1', seq: 1, liveness: 'live', action: 'stopped' },
    {
      attemptId: 'dispatch-lost',
      taskId: 'task-2',
      seq: 1,
      liveness: 'unverifiable',
      action: 'abandoned'
    }
  ]
  const call = vi.spyOn(client, 'call').mockResolvedValue({
    id: 'rpc',
    ok: true,
    result: { mission: { ...mission, status: 'CANCELED' }, attempts },
    _meta: { runtimeId: 'test' }
  })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/tmp', json })
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'axiom.mission.cancel',
    { missionId: mission.id, reason: 'user request' },
    { orchestrationRequestId: undefined }
  )
  const output = String(log.mock.calls[0]?.[0])
  if (json) {
    expect(JSON.parse(output).result.attempts).toEqual(attempts)
  } else {
    expect(output).toContain('Attempt dispatch-live: stopped')
    expect(output).toContain('Attempt dispatch-lost: abandoned')
  }
})
