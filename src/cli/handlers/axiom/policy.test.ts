import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../../runtime-client'
import { dispatch } from '../../dispatch'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-policy-cli-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

async function command(args: string[]) {
  const parsed = parseArgs(
    ['mission', 'policy', ...args, '--mission', 'm', '--json'],
    COMMAND_SPECS.map((s) => s.path),
    COMMAND_SPECS
  )
  validateCommandAndFlags(COMMAND_SPECS, parsed)
  const client = new RuntimeClient(root, 500, null, null)
  const call = vi.spyOn(client, 'call').mockResolvedValue({
    id: 'rpc',
    ok: true,
    result: { policy: {} },
    _meta: { runtimeId: 'runtime' }
  })
  vi.spyOn(console, 'log').mockImplementation(() => undefined)
  await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: root, json: true })
  return call
}

describe('mission policy CLI', () => {
  it('reads and validates --verification-rules-file', async () => {
    const file = path.join(root, 'verification.json')
    await writeFile(file, JSON.stringify({ setupCommands: [' node --version '] }))
    expect(await command(['update', '--verification-rules-file', file])).toHaveBeenCalledWith(
      'axiom.policy.update',
      {
        missionId: 'm',
        patch: {
          verificationRules: expect.objectContaining({
            setupCommands: ['node --version'],
            timeBudgetMinutes: 30
          })
        }
      },
      { orchestrationRequestId: undefined }
    )
    for (const value of [{ commands: [] }, { timeBudgetMinutes: '30' }]) {
      await writeFile(file, JSON.stringify(value))
      await expect(command(['update', '--verification-rules-file', file])).rejects.toMatchObject({
        code: 'invalid_argument'
      })
    }
  })
  it('routes show through the registered subgroup', async () => {
    expect(await command(['show'])).toHaveBeenCalledExactlyOnceWith(
      'axiom.policy.show',
      { missionId: 'm' },
      { orchestrationRequestId: undefined }
    )
  })
  it('routes validated routing and concurrency updates through the subgroup', async () => {
    await writeFile(
      path.join(root, 'routing.json'),
      JSON.stringify({ preferredProviders: ['codex'] })
    )
    expect(
      await command(['update', '--routing-file', 'routing.json', '--concurrency', '2'])
    ).toHaveBeenCalledExactlyOnceWith(
      'axiom.policy.update',
      {
        missionId: 'm',
        patch: {
          concurrencyLimit: 2,
          routing: {
            preferredProviders: ['codex'],
            disallowedProviders: [],
            highRiskTier: 'A',
            providerConcurrency: {},
            models: {}
          }
        }
      },
      { orchestrationRequestId: undefined }
    )
  })
  it('rejects malformed files and invalid concurrency locally', async () => {
    await writeFile(path.join(root, 'routing.json'), '{')
    await expect(command(['update', '--routing-file', 'routing.json'])).rejects.toMatchObject({
      code: 'invalid_argument'
    })
    await expect(command(['update', '--concurrency', '0'])).rejects.toMatchObject({
      code: 'invalid_argument'
    })
  })
})
