import { describe, expect, it } from 'vitest'
import {
  ArtifactKind,
  ArtifactPutParams,
  ArtifactReadParams,
  ArtifactListParams,
  MAX_ARTIFACT_BYTES
} from './artifact-params'

const put = {
  missionId: 'm',
  kind: 'evidence',
  contentBase64: 'aGk=',
  mediaType: 'text/plain',
  related: ['t'],
  createdBy: 'worker'
}
describe('artifact wire contract', () => {
  it('validates kinds, ids, related ids and canonical base64', () => {
    expect(ArtifactPutParams.parse(put)).toEqual(put)
    expect(ArtifactKind.options).toHaveLength(7)
    for (const patch of [
      { kind: 'unknown' },
      { missionId: '' },
      { related: [''] },
      { contentBase64: '%%%=' },
      { contentBase64: 'hi' }
    ]) {
      expect(ArtifactPutParams.safeParse({ ...put, ...patch }).success).toBe(false)
    }
    expect(ArtifactPutParams.safeParse({ ...put, contentBase64: '' }).success).toBe(true)
    expect(ArtifactReadParams.parse({ id: 'art_1' })).toEqual({ id: 'art_1' })
    expect(ArtifactListParams.parse({ missionId: 'm', kind: 'handoff', relatedTo: 't' })).toEqual({
      missionId: 'm',
      kind: 'handoff',
      relatedTo: 't'
    })
  })
  it('accepts exactly 8 MiB and rejects even one extra byte', () => {
    expect(
      ArtifactPutParams.safeParse({
        ...put,
        contentBase64: Buffer.alloc(MAX_ARTIFACT_BYTES).toString('base64')
      }).success
    ).toBe(true)
    expect(
      ArtifactPutParams.safeParse({
        ...put,
        contentBase64: Buffer.alloc(MAX_ARTIFACT_BYTES + 1).toString('base64')
      }).success
    ).toBe(false)
  })
})
