import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ArtifactPutResponseSchema,
  ArtifactReadResponseSchema
} from '../../../shared/axiom-contract/artifact-params'
import { getAppEnvironment } from '../../../shared/app-environment'
import { MissionCreateResponseSchema } from '../../../shared/axiom-contract/mission-params'
import type { RpcResponse } from '../../runtime/rpc/core'
import { getAxiomControlPlane } from '../control-plane'
import { rpcFixture, createParams } from '../rpc-fixture.test-support'

let root: string
let f: ReturnType<typeof rpcFixture>
let missionId: string
function result(response: RpcResponse) {
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return response.result
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-artifact-rpc-'))
  const environment = getAppEnvironment()
  const getPath = environment.getPath.bind(environment)
  vi.spyOn(environment, 'getPath').mockImplementation((name) =>
    name === 'userData' ? root : getPath(name)
  )
  f = rpcFixture()
  missionId = MissionCreateResponseSchema.parse(
    result(await f.call('axiom.mission.create', createParams))
  ).mission.id
})
afterEach(async () => {
  vi.restoreAllMocks()
  f?.db.close()
  await rm(root, { recursive: true, force: true })
})

describe('artifact RPC', () => {
  it('round trips binary content through registered methods and durable receipts', async () => {
    const bytes = Buffer.from([0, 255, 1, 128])
    const params = {
      missionId,
      kind: 'evidence',
      contentBase64: bytes.toString('base64'),
      mediaType: 'application/octet-stream',
      related: ['t'],
      createdBy: 'tester'
    }
    const first = await f.call('axiom.artifact.put', params, {
      orchestrationRequestId: 'artifact-request'
    })
    const { artifact } = ArtifactPutResponseSchema.parse(result(first))
    expect(
      ArtifactPutResponseSchema.parse(
        result(
          await f.call('axiom.artifact.put', params, { orchestrationRequestId: 'artifact-request' })
        )
      )
    ).toEqual({ artifact })
    const changed = await f.call(
      'axiom.artifact.put',
      { ...params, kind: 'log' },
      { orchestrationRequestId: 'artifact-request' }
    )
    expect(changed).toMatchObject({ ok: false, error: { code: 'request_mismatch' } })
    const read = ArtifactReadResponseSchema.parse(
      result(await f.call('axiom.artifact.read', { id: artifact.id }))
    )
    expect(Buffer.from(read.contentBase64, 'base64')).toEqual(bytes)
    expect(
      result(await f.call('axiom.artifact.list', { missionId, kind: 'evidence', relatedTo: 't' }))
    ).toEqual({ artifacts: [artifact] })
    expect(getAxiomControlPlane(f.runtime).contextBuilder).toBeDefined()
    await writeFile(path.join(root, 'axiom', 'artifacts', artifact.sha256), 'broken')
    expect(await f.call('axiom.artifact.read', { id: artifact.id })).toMatchObject({
      ok: false,
      error: { code: 'artifact_corrupt' }
    })
    expect(await f.call('axiom.artifact.read', { id: 'missing' })).toMatchObject({
      ok: false,
      error: { code: 'artifact_not_found' }
    })
  })

  it('requires the mutation contract and rejects malformed wire content', async () => {
    const params = {
      missionId,
      kind: 'evidence',
      contentBase64: '%%%%',
      mediaType: 'text/plain',
      related: [],
      createdBy: 'tester'
    }
    expect(await f.call('axiom.artifact.put', params)).toMatchObject({
      ok: false,
      error: { code: 'invalid_argument' }
    })
    expect(
      await f.call(
        'axiom.artifact.put',
        { ...params, contentBase64: '' },
        { orchestrationContractVersion: undefined }
      )
    ).toMatchObject({ ok: false, error: { code: 'orchestration_migration_required' } })
    expect(f.store.listArtifacts({ missionId })).toEqual([])
  })
})
