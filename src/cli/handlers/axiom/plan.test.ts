import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { RuntimeClient, RuntimeRpcFailureError } from '../../runtime-client'
import { reportCliError } from '../../cli-error'
import { dispatch } from '../../dispatch'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { makeProposal } from '../../../shared/axiom-contract/contract-fixtures.test-support'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
it('prints dirty planner files and preserves their structured JSON details', () => {
  const files = [' M src/file.ts', '?? proposal.json']
  const response = {
    id: 'planner-proposal',
    ok: false as const,
    error: {
      code: 'planner_worktree_dirty',
      message: `Planner worktree must be clean before proposing a plan:\n${files.join('\n')}`,
      data: { files }
    },
    _meta: { runtimeId: 'test' }
  }
  const error = new RuntimeRpcFailureError(response)
  const stderr = vi.spyOn(console, 'error').mockImplementation(() => {})
  const stdout = vi.spyOn(console, 'log').mockImplementation(() => {})
  reportCliError(error, false, { commandPath: ['plan', 'propose'] })
  expect(stderr).toHaveBeenCalledExactlyOnceWith(
    `planner_worktree_dirty: ${response.error.message}`
  )
  reportCliError(error, true, { commandPath: ['plan', 'propose'] })
  expect(stdout).toHaveBeenCalledExactlyOnceWith(JSON.stringify(response, null, 2))
})

it.each([true, false])(
  'routes a planner/user proposal with the correct identity (planner=%s)',
  async (planner) => {
    const root = await mkdtemp(path.join(tmpdir(), 'axiom-plan-cli-'))
    try {
      const { provenance, ...planRevision } = makeProposal()
      await writeFile(
        path.join(root, 'proposal.json'),
        JSON.stringify(planner ? planRevision : { ...planRevision, provenance })
      )
      vi.stubEnv('ORCA_TERMINAL_HANDLE', 'term_planner')
      const client = new RuntimeClient('/unused', 500, null, null)
      const call = vi
        .spyOn(client, 'call')
        .mockResolvedValue({ id: 'rpc', ok: true, result: {}, _meta: { runtimeId: 'test' } })
      vi.spyOn(console, 'log').mockImplementation(() => {})
      const parsed = parseArgs(
        [
          'plan',
          'propose',
          '--mission',
          'm',
          '--file',
          'proposal.json',
          '--json',
          ...(planner ? ['--attempt', 'a', '--dispatch-capability', 'dcap_fixture'] : [])
        ],
        COMMAND_SPECS.map((s) => s.path),
        COMMAND_SPECS
      )
      validateCommandAndFlags(COMMAND_SPECS, parsed)
      await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: root, json: true })
      expect(call).toHaveBeenCalledExactlyOnceWith(
        'axiom.plan.propose',
        {
          missionId: 'm',
          planRevision,
          ...(planner ? { attemptId: 'a', from: 'term_planner' } : { provenance })
        },
        planner
          ? { orchestrationCapability: 'dcap_fixture' }
          : { orchestrationRequestId: undefined }
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
)
