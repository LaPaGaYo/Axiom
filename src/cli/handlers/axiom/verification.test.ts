import { afterEach, expect, it, vi } from 'vitest'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { dispatch } from '../../dispatch'
import { RuntimeClient } from '../../runtime-client'
import { VerificationRunViewSchema } from '../../../shared/axiom-contract/verification-params'
import { formatVerificationRun, formatVerificationRunList } from '../../axiom-format'

afterEach(() => {
  vi.restoreAllMocks()
})
it.each([
  {
    args: ['show', '--run', 'run-one'],
    method: 'axiom.verification.show',
    params: { runId: 'run-one' }
  },
  {
    args: [
      'list',
      '--mission',
      'mission-one',
      '--task',
      'task-one',
      '--candidate',
      'candidate-one',
      '--status',
      'RUNNING'
    ],
    method: 'axiom.verification.list',
    params: {
      missionId: 'mission-one',
      taskId: 'task-one',
      candidateId: 'candidate-one',
      status: 'RUNNING'
    }
  }
])('registers and routes $method as a read', async ({ args, method, params }) => {
  const client = new RuntimeClient('/unused', 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'runtime' } })
  vi.spyOn(console, 'log').mockImplementation(() => {})
  const parsed = parseArgs(
    ['verification', ...args, '--json'],
    COMMAND_SPECS.map((s) => s.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/unused', json: true })
  expect(call).toHaveBeenCalledExactlyOnceWith(method, params, {
    orchestrationRequestId: undefined
  })
})

it('formats identity, status, phase, claim, timestamp and isolated worktree', () => {
  const run = VerificationRunViewSchema.parse({
    id: 'run-one',
    missionId: 'mission-one',
    taskId: 'task-one',
    candidateId: 'candidate-one',
    status: 'RUNNING',
    verifier: 'VerificationService',
    verdictDetail: { phase: 'prepared' },
    commands: [],
    toolVersions: {},
    createdAt: 'now',
    updatedAt: 'now',
    runtimeEpoch: 'epoch-one',
    claimCount: 2,
    worktreeId: 'repo::/verify',
    startedAt: '2026-10-20T12:00:00Z',
    finishedAt: null,
    candidateCommitSha: 'a'.repeat(40),
    candidateTreeSha: 'b'.repeat(40),
    phase: 'prepared'
  })
  const text = formatVerificationRun({ run })
  for (const value of [
    'run-one',
    'task-one',
    'aaaaaaa',
    'RUNNING',
    'prepared',
    '2',
    run.startedAt!,
    'repo::/verify'
  ]) {
    expect(text).toContain(value)
  }
  expect(formatVerificationRunList({ runs: [run] })).toBe(text)
  expect(formatVerificationRunList({ runs: [] })).toContain('CANDIDATE')
})
