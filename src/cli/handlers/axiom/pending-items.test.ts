import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, writeFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RuntimeClient } from '../../runtime-client'
import { dispatch } from '../../dispatch'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { makeProposal } from '../../../shared/axiom-contract/contract-fixtures.test-support'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
function setup() {
  const client = new RuntimeClient('/unused', 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'runtime' } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  async function run(args: string[], cwd = '/unused') {
    const parsed = parseArgs(
      [...args, '--json'],
      COMMAND_SPECS.map((s) => s.path),
      COMMAND_SPECS
    )
    validateCommandAndFlags(COMMAND_SPECS, parsed)
    await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd, json: true })
  }
  return { call, run }
}
it('routes ask with repeated options, resume, caller identity, retry id and transport grace', async () => {
  const f = setup()
  vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term_worker')
  await f.run([
    'attempt',
    'ask',
    '--attempt',
    'a',
    '--question',
    'Format?',
    '--option',
    'JSON',
    '--option',
    'CSV',
    '--timeout-ms',
    '120000',
    '--resume',
    'q',
    '--retry-request',
    '55cbf3b9-90ab-4ac0-a4e3-660c26727a1f'
  ])
  expect(f.call).toHaveBeenCalledWith(
    'axiom.attempt.ask',
    expect.objectContaining({
      attemptId: 'a',
      question: 'Format?',
      options: ['JSON', 'CSV'],
      resume: 'q'
    }),
    {
      timeoutMs: 125000,
      orchestrationRequestId: '55cbf3b9-90ab-4ac0-a4e3-660c26727a1f'
    }
  )
})
it('routes pending list and answer', async () => {
  const f = setup()
  await f.run(['message', 'list', '--mission', 'm', '--type', 'QUESTION', '--pending'])
  expect(f.call).toHaveBeenLastCalledWith(
    'axiom.message.list',
    { missionId: 'm', type: 'QUESTION', pendingOnly: true },
    expect.anything()
  )
  await f.run(['message', 'answer', '--mission', 'm', '--question', 'q', '--body', 'JSON'])
  expect(f.call).toHaveBeenLastCalledWith(
    'axiom.message.answer',
    { missionId: 'm', questionId: 'q', body: 'JSON' },
    expect.anything()
  )
})
it.each(['accept', 'reject'])(
  'routes resolve --%s and requires exactly one decision',
  async (decision) => {
    const f = setup()
    const args = [
      'message',
      'resolve',
      '--mission',
      'm',
      '--message',
      'msg',
      '--rationale',
      'Reviewed'
    ]
    await f.run([...args, `--${decision}`])
    expect(f.call).toHaveBeenLastCalledWith(
      'axiom.message.resolve',
      { missionId: 'm', messageId: 'msg', decision, rationale: 'Reviewed' },
      expect.anything()
    )
    await expect(f.run(args)).rejects.toThrow()
    await expect(f.run([...args, '--accept', '--reject'])).rejects.toThrow()
  }
)
it('loads task JSON and repeated dependencies with stable user provenance', async () => {
  const f = setup()
  const dir = await mkdtemp(path.join(tmpdir(), 'axiom-task-cli-'))
  try {
    const { id: _id, ...task } = makeProposal().tasks[0]!
    await writeFile(path.join(dir, 'task.json'), JSON.stringify(task))
    await f.run(
      [
        'task',
        'create',
        '--mission',
        'm',
        '--file',
        'task.json',
        '--depends-on',
        't1',
        '--depends-on',
        't2'
      ],
      dir
    )
    expect(f.call).toHaveBeenCalledWith(
      'axiom.task.create',
      {
        missionId: 'm',
        task,
        dependsOn: ['t1', 't2'],
        provenance: {
          kind: 'user',
          actor: 'user',
          at: (await stat(path.join(dir, 'task.json'))).mtime.toISOString()
        }
      },
      expect.anything()
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
it('carries repeated REQUEST_SUBTASK dependencies through the Worker CLI', async () => {
  const f = setup()
  vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term_worker')
  await f.run([
    'attempt',
    'request-subtask',
    '--attempt',
    'a',
    '--summary',
    'Split',
    '--title',
    'New task',
    '--objective',
    'Check',
    '--allowed-path',
    'src/x',
    '--acceptance',
    'Pass',
    '--evidence',
    'Test',
    '--depends-on',
    't1',
    '--depends-on',
    't2'
  ])
  expect(f.call).toHaveBeenCalledWith(
    'axiom.attempt.request-subtask',
    expect.objectContaining({ subtask: expect.objectContaining({ dependsOn: ['t1', 't2'] }) })
  )
})
