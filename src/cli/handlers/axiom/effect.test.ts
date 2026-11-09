import { afterEach, expect, it, vi } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { dispatch } from '../../dispatch'
import { RuntimeClient } from '../../runtime-client'

afterEach(() => vi.restoreAllMocks())

it.each([true, false])('lists Mission effects through the read RPC (json=%s)', async (json) => {
  const client = new RuntimeClient('/unused', 500, null, null)
  const effect = {
    id: 'effect-one',
    missionId: 'mission-one',
    kind: 'verification.enqueue',
    key: 'run-one',
    payload: { runId: 'run-one' },
    status: 'failed',
    dueAt: '2026-11-09T00:00:00.000Z',
    attempts: 3,
    leaseEpoch: null,
    lastError: 'wake failed',
    createdAt: '2026-11-09T00:00:00.000Z',
    updatedAt: '2026-11-09T00:00:00.000Z'
  }
  const call = vi.spyOn(client, 'call').mockResolvedValue({
    id: 'rpc',
    ok: true,
    result: { effects: [effect] },
    _meta: { runtimeId: 'runtime' }
  })
  const log = vi.spyOn(console, 'log').mockImplementation(() => {})
  const parsed = parseArgs(
    [
      'mission',
      'effect',
      'list',
      '--mission',
      'mission-one',
      '--status',
      'failed',
      ...(json ? ['--json'] : [])
    ],
    COMMAND_SPECS.map((spec) => spec.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/unused', json })
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'axiom.effect.list',
    { missionId: 'mission-one', status: 'failed' },
    { orchestrationRequestId: undefined }
  )
  const output = log.mock.calls.flat().join('\n')
  if (json) {
    expect(JSON.parse(output)).toMatchObject({ ok: true, result: { effects: [effect] } })
  } else {
    for (const text of [
      'KIND',
      'KEY',
      'STATUS',
      'ATTEMPTS',
      'DUE',
      'LAST_ERROR',
      'verification.enqueue',
      'run-one',
      'failed',
      '3',
      effect.dueAt,
      'wake failed'
    ]) {
      expect(output).toContain(text)
    }
  }
})
