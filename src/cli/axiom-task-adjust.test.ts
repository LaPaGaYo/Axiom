import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from './runtime-client'
import { parseArgs, validateCommandAndFlags } from './args'
import { dispatch } from './dispatch'
import { COMMAND_SPECS } from './specs'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
async function run(args: string[], result: unknown = {}, json = true) {
  const parsed = parseArgs(
    [...args, ...(json ? ['--json'] : [])],
    COMMAND_SPECS.map((entry) => entry.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const client = new RuntimeClient('/fixture', 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result, _meta: { runtimeId: 'test' } })
  const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/fixture', json })
  return { call, output }
}
it('maps repeated adjustment paths and a positive retry ceiling', async () => {
  const { call } = await run([
    'task',
    'adjust',
    '--task',
    'task-1',
    '--rationale',
    'Reviewed',
    '--add-path',
    'a.ts',
    '--add-path',
    'b.ts',
    '--max-attempts',
    '4'
  ])
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'axiom.task.adjust',
    {
      taskId: 'task-1',
      rationale: 'Reviewed',
      addAllowedPaths: ['a.ts', 'b.ts'],
      maxAttempts: 4
    },
    { orchestrationRequestId: undefined }
  )
})
it('allows rationale-only adjustment', async () => {
  const { call } = await run(['task', 'adjust', '--task', 'task-1', '--rationale', 'Reviewed'])
  expect(call).toHaveBeenCalledWith(
    'axiom.task.adjust',
    {
      taskId: 'task-1',
      rationale: 'Reviewed',
      addAllowedPaths: [],
      maxAttempts: undefined
    },
    { orchestrationRequestId: undefined }
  )
})
it.each(['0', '-1', '1.5'])('refuses invalid retry ceiling %s', async (value) => {
  await expect(
    run(['task', 'adjust', '--task', 'task-1', '--rationale', 'Reviewed', '--max-attempts', value])
  ).rejects.toMatchObject({ code: 'invalid_argument' })
})
it.each(['blocked_by_scope', 'candidate_already_correct', 'cannot_reproduce'])(
  'maps the terminal BLOCKED reason %s and repeated paths',
  async (reason) => {
    vi.stubEnv('ORCA_AGENT_SESSION_ID', '')
    vi.stubEnv('ORCA_PANE_KEY', '')
    const { call } = await run([
      'attempt',
      'blocked',
      '--attempt',
      'attempt-1',
      '--from',
      'term_worker',
      '--summary',
      'Blocked',
      '--reason',
      reason,
      '--path',
      'a.ts',
      '--path',
      'b.ts'
    ])
    expect(call).toHaveBeenCalledWith(
      'axiom.attempt.blocked',
      expect.objectContaining({
        attemptId: 'attempt-1',
        from: 'term_worker',
        summary: 'Blocked',
        blocked: { reason, paths: ['a.ts', 'b.ts'] }
      })
    )
  }
)
it('refuses invalid blocked reasons and paths without a reason', async () => {
  for (const tail of [
    ['--reason', 'other'],
    ['--path', 'a.ts']
  ]) {
    await expect(
      run([
        'attempt',
        'blocked',
        '--attempt',
        'attempt-1',
        '--from',
        'term_worker',
        '--summary',
        'Blocked',
        ...tail
      ])
    ).rejects.toMatchObject({ code: 'invalid_argument' })
  }
})
it('prints the reason and paths of pending BLOCKED messages', async () => {
  const { output } = await run(
    ['message', 'list', '--mission', 'mission-1', '--pending'],
    {
      messages: [
        {
          id: 'message-1',
          type: 'BLOCKED',
          taskId: 'task-1',
          attemptId: 'attempt-1',
          summary: 'Blocked',
          artifactIds: [],
          related: {},
          createdAt: 'now',
          pending: true,
          blocked: { reason: 'blocked_by_scope', paths: ['a.ts', 'b.ts'] }
        }
      ]
    },
    false
  )
  expect(output).toHaveBeenCalledWith(expect.stringContaining('blocked_by_scope'))
  expect(output).toHaveBeenCalledWith(expect.stringContaining('a.ts, b.ts'))
})
