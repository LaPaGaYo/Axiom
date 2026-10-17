import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RuntimeClient } from '../../runtime-client'
import { dispatch } from '../../dispatch'
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

describe('Worker channel CLI routing', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })
  function setup() {
    vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term_worker')
    vi.stubEnv('ORCA_PANE_KEY', 'pane_worker')
    const client = new RuntimeClient('/unused', 500, null, null)
    const call = vi
      .spyOn(client, 'call')
      .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'runtime' } })
    vi.spyOn(console, 'log').mockImplementation(() => {})
    async function run(args: string[], cwd = '/unused') {
      const parsed = parseArgs(
        ['attempt', ...args, '--json'],
        COMMAND_SPECS.map((s) => s.path),
        COMMAND_SPECS
      )
      validateCommandAndFlags(COMMAND_SPECS, parsed)
      await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd, json: true })
    }
    return { call, run }
  }
  it.each(['inform', 'request', 'blocked', 'handoff', 'request-subtask'])(
    'routes %s with repeated references, caller identity, capability and retry id',
    async (verb) => {
      const f = setup()
      const subtaskFlags =
        verb === 'request-subtask'
          ? [
              '--title',
              'Follow-up',
              '--objective',
              'Check',
              '--allowed-path',
              'src/',
              '--allowed-path',
              'tests/',
              '--acceptance',
              'Pass',
              '--evidence',
              'Tests',
              '--risk',
              'medium'
            ]
          : []
      await f.run([
        verb,
        '--attempt',
        'a',
        '--dispatch-capability',
        'dcap_fixture',
        '--summary',
        'Evidence',
        '--body',
        'Detail',
        '--artifact',
        'art-1',
        '--artifact',
        'art-2',
        '--related-task',
        't1',
        '--related-task',
        't2',
        '--retry-request',
        '55cbf3b9-90ab-4ac0-a4e3-660c26727a1f',
        ...subtaskFlags
      ])
      expect(f.call).toHaveBeenCalledExactlyOnceWith(
        `axiom.attempt.${verb}`,
        {
          attemptId: 'a',
          from: 'term_worker',
          senderPaneKey: 'pane_worker',
          summary: 'Evidence',
          body: 'Detail',
          artifactIds: ['art-1', 'art-2'],
          related: { taskIds: ['t1', 't2'] },
          ...(verb === 'request-subtask'
            ? {
                subtask: {
                  title: 'Follow-up',
                  objective: 'Check',
                  allowedPaths: ['src/', 'tests/'],
                  acceptanceCriteria: ['Pass'],
                  requiredEvidence: ['Tests'],
                  risk: 'medium'
                }
              }
            : {})
        },
        {
          orchestrationCapability: 'dcap_fixture',
          orchestrationRequestId: '55cbf3b9-90ab-4ac0-a4e3-660c26727a1f'
        }
      )
    }
  )
  it('routes check with capability and a transport budget longer than the inner wait', async () => {
    const f = setup()
    await f.run([
      'check',
      '--attempt',
      'a',
      '--dispatch-capability',
      'dcap_fixture',
      '--wait',
      '--timeout-ms',
      '120000',
      '--type',
      'status'
    ])
    expect(f.call).toHaveBeenCalledExactlyOnceWith(
      'axiom.attempt.check',
      {
        attemptId: 'a',
        from: 'term_worker',
        senderPaneKey: 'pane_worker',
        wait: true,
        timeoutMs: 120000,
        type: 'status'
      },
      { orchestrationCapability: 'dcap_fixture', timeoutMs: 130000 }
    )
  })
  it('reads body-file relative to cwd and refuses mutually exclusive body flags', async () => {
    const f = setup()
    const dir = await mkdtemp(path.join(tmpdir(), 'axiom-channel-cli-'))
    try {
      await writeFile(path.join(dir, 'body.txt'), 'Detailed evidence')
      const flags = [
        'inform',
        '--attempt',
        'a',
        '--dispatch-capability',
        'dcap_fixture',
        '--summary',
        'Evidence',
        '--body-file',
        'body.txt'
      ]
      await f.run(flags, dir)
      expect(f.call).toHaveBeenCalledWith(
        'axiom.attempt.inform',
        expect.objectContaining({ body: 'Detailed evidence' }),
        { orchestrationCapability: 'dcap_fixture' }
      )
      f.call.mockClear()
      await expect(f.run([...flags, '--body', 'conflict'], dir)).rejects.toMatchObject({
        code: 'invalid_argument'
      })
      expect(f.call).not.toHaveBeenCalled()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
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
