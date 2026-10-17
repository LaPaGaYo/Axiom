import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RuntimeClient } from '../../runtime-client'
import { dispatch } from '../../dispatch'
import { parseArgs, validateCommandAndFlags } from '../../args'
import { COMMAND_SPECS } from '../../specs'
import { AXIOM_ARTIFACT_HANDLERS } from './artifact'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-artifact-cli-'))
})
afterEach(async () => {
  vi.restoreAllMocks()
  await rm(root, { recursive: true, force: true })
})

describe('mission artifact CLI', () => {
  it.each([
    {
      verb: 'put',
      flags: [
        '--mission',
        'm',
        '--kind',
        'handoff',
        '--file',
        'evidence.bin',
        '--related',
        't1,t2',
        '--retry-request',
        '11111111-1111-4111-8111-111111111111'
      ],
      method: 'axiom.artifact.put',
      params: {
        missionId: 'm',
        kind: 'handoff',
        contentBase64: 'AP8=',
        mediaType: 'application/octet-stream',
        related: ['t1', 't2'],
        createdBy: 'user'
      }
    },
    {
      verb: 'read',
      flags: ['--artifact', 'a'],
      method: 'axiom.artifact.read',
      params: { id: 'a' }
    },
    {
      verb: 'list',
      flags: ['--mission', 'm', '--kind', 'handoff', '--related', 't'],
      method: 'axiom.artifact.list',
      params: { missionId: 'm', kind: 'handoff', relatedTo: 't' }
    }
  ])('routes $verb through the registered subgroup', async ({ verb, flags, method, params }) => {
    await writeFile(path.join(root, 'evidence.bin'), Buffer.from([0, 255]))
    const parsed = parseArgs(
      ['mission', 'artifact', verb, ...flags, '--json'],
      COMMAND_SPECS.map((s) => s.path),
      COMMAND_SPECS
    )
    validateCommandAndFlags(COMMAND_SPECS, parsed)
    const client = new RuntimeClient(root, 500, null, null)
    const call = vi.spyOn(client, 'call').mockResolvedValue({
      id: 'rpc',
      ok: true,
      result: { contentBase64: 'AP8=' },
      _meta: { runtimeId: 'runtime' }
    })
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await dispatch(parsed.commandPath, { flags: parsed.flags, client, cwd: root, json: true })
    expect(call).toHaveBeenCalledExactlyOnceWith(method, params, {
      orchestrationRequestId: verb === 'put' ? '11111111-1111-4111-8111-111111111111' : undefined
    })
    expect(output).toHaveBeenCalled()
  })
  it('rejects oversized files locally without invoking RPC', async () => {
    await writeFile(path.join(root, 'large'), Buffer.alloc(MAX_ARTIFACT_BYTES + 1))
    const client = new RuntimeClient(root, 500, null, null)
    const call = vi.spyOn(client, 'call')
    const flags = new Map([
      ['mission', 'm'],
      ['kind', 'evidence'],
      ['file', 'large']
    ])
    await expect(
      AXIOM_ARTIFACT_HANDLERS['mission artifact put']({ flags, client, cwd: root, json: true })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    expect(call).not.toHaveBeenCalled()
  })
})
