import { afterEach, expect, it, vi } from 'vitest'
import { RuntimeClient } from './runtime-client'
import { parseArgs, validateCommandAndFlags } from './args'
import { dispatch } from './dispatch'
import { COMMAND_SPECS } from './specs'
import { formatVerificationRunList } from './axiom-format'
import { VerificationRunViewSchema } from '../shared/axiom-contract/verification-params'

afterEach(() => vi.restoreAllMocks())
async function run(args: string[]) {
  const parsed = parseArgs(
    [...args, '--json'],
    COMMAND_SPECS.map((spec) => spec.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const client = new RuntimeClient('/fixture', 500, null, null)
  const call = vi
    .spyOn(client, 'call')
    .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'test' } })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: '/fixture', json: true })
  return call
}
it('maps a human verdict, repeated zero-based indices, and receipt replay', async () => {
  const receipt = '11111111-1111-4111-8111-111111111111'
  const call = await run([
    'verification',
    'resolve',
    '--run',
    'v1',
    '--verdict',
    'FAIL',
    '--rationale',
    'Missing example',
    '--criterion',
    '0',
    '--criterion',
    '2',
    '--retry-request',
    receipt
  ])
  expect(call).toHaveBeenCalledExactlyOnceWith(
    'axiom.verification.resolve',
    { runId: 'v1', verdict: 'FAIL', rationale: 'Missing example', criteria: [0, 2] },
    { orchestrationRequestId: receipt }
  )
})
it.each(['-1', '1.5', 'no', ''])('rejects an invalid criterion index %s', async (value) => {
  await expect(
    run([
      'verification',
      'resolve',
      '--run',
      'v1',
      '--verdict',
      'PASS',
      '--rationale',
      'Done',
      '--criterion',
      value
    ])
  ).rejects.toMatchObject({ code: 'invalid_argument' })
})
it('rejects an unknown verdict', async () => {
  await expect(
    run(['verification', 'resolve', '--run', 'v1', '--verdict', 'maybe', '--rationale', 'Done'])
  ).rejects.toMatchObject({ code: 'invalid_argument' })
})
it('rejects an empty index among repeated criteria', async () => {
  await expect(
    run([
      'verification',
      'resolve',
      '--run',
      'v1',
      '--verdict',
      'FAIL',
      '--rationale',
      'Missing example',
      '--criterion',
      '1',
      '--criterion',
      ''
    ])
  ).rejects.toMatchObject({ code: 'invalid_argument' })
})
it('maps a rerun request', async () => {
  expect(
    await run(['verification', 'rerun', '--task', 't1', '--rationale', 'Criteria fixed'])
  ).toHaveBeenCalledExactlyOnceWith(
    'axiom.verification.rerun',
    { taskId: 't1', rationale: 'Criteria fixed' },
    { orchestrationRequestId: undefined }
  )
})
it('maps full criteria replacement with unmatched human criteria and artifacts', async () => {
  expect(
    await run([
      'task',
      'adjust',
      '--task',
      't1',
      '--rationale',
      'Criteria fixed',
      '--acceptance',
      'Tests',
      '--evidence',
      'pnpm test',
      '--acceptance',
      'Example',
      '--acceptance-artifact',
      'Report'
    ])
  ).toHaveBeenCalledWith(
    'axiom.task.adjust',
    expect.objectContaining({
      acceptanceCriteria: [
        { text: 'Tests', check: { kind: 'command', command: 'pnpm test' } },
        { text: 'Example', check: { kind: 'human' } },
        { text: 'Report', check: { kind: 'artifact' } }
      ]
    }),
    { orchestrationRequestId: undefined }
  )
})
it('prints the reason and escalation for pending human review', () => {
  const run = VerificationRunViewSchema.parse({
    id: 'v1',
    taskId: 't1',
    candidateId: 'c1',
    missionId: 'm1',
    status: 'HUMAN_REVIEW',
    phase: 'verdict',
    verdictDetail: { reason: 'flaky', escalation: 'specialist' },
    commands: [],
    toolVersions: {},
    verifier: 'VerificationService',
    runtimeEpoch: null,
    claimCount: 1,
    worktreeId: null,
    startedAt: null,
    finishedAt: null,
    createdAt: 'now',
    updatedAt: 'now',
    candidateCommitSha: 'a'.repeat(40),
    candidateTreeSha: 'b'.repeat(40)
  })
  expect(formatVerificationRunList({ runs: [run] })).toContain('flaky\tspecialist')
})
