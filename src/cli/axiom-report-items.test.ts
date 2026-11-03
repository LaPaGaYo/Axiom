import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from './runtime-client'
import { parseArgs, validateCommandAndFlags } from './args'
import { dispatch } from './dispatch'
import { COMMAND_SPECS } from './specs'

afterEach(() => {
  vi.restoreAllMocks()
})
it.each(['--pending', '--pending-only'])(
  'prints typed question and follow-up projections through message list %s',
  async (flag) => {
    const parsed = parseArgs(
      ['message', 'list', '--mission', 'm', flag],
      COMMAND_SPECS.map((s) => s.path),
      COMMAND_SPECS
    )
    validateCommandAndFlags(COMMAND_SPECS, parsed)
    const base = { taskId: 't', attemptId: 'a', artifactIds: [], related: {}, createdAt: 'now' }
    const client = new RuntimeClient('/fixture', 500, null, null)
    const call = vi.spyOn(client, 'call').mockResolvedValue({
      id: 'rpc',
      ok: true,
      _meta: { runtimeId: 'test' },
      result: {
        messages: [
          {
            ...base,
            id: 'q1',
            type: 'QUESTION',
            summary: 'Proceed?',
            question: 'Proceed?',
            options: [],
            status: 'pending',
            answer: null,
            pending: true
          },
          {
            ...base,
            id: 'q2',
            type: 'QUESTION',
            summary: 'Which format?',
            question: 'Which format?',
            options: ['JSON'],
            status: 'answered',
            answer: 'JSON',
            pending: false
          },
          {
            ...base,
            id: 'f1',
            type: 'REQUEST',
            summary: 'Leap days',
            followUp: { text: 'Leap days' },
            pending: true
          },
          {
            ...base,
            id: 'f2',
            type: 'REQUEST',
            summary: 'Leap days',
            followUp: { text: 'Leap days' },
            pending: false
          },
          {
            ...base,
            id: 'b',
            type: 'BLOCKED',
            summary: 'Need scope',
            pending: true,
            blocked: { reason: 'blocked_by_scope', paths: ['src/test.ts'] }
          }
        ]
      }
    })
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    await dispatch(parsed.commandPath, {
      flags: parsed.flags,
      client,
      cwd: '/fixture',
      json: false
    })
    expect(call).toHaveBeenCalledWith(
      'axiom.message.list',
      { missionId: 'm', type: undefined, pendingOnly: true },
      { orchestrationRequestId: undefined }
    )
    expect(output.mock.calls[0]?.[0]).toBe(
      [
        'q1  QUESTION  pending  Proceed?',
        'q2  QUESTION  answered  Which format? → JSON',
        'f1  REQUEST  pending  follow-up: Leap days',
        'f2  REQUEST  resolved  follow-up: Leap days',
        'b  BLOCKED  pending  Need scope  blocked_by_scope: src/test.ts'
      ].join('\n')
    )
  }
)
