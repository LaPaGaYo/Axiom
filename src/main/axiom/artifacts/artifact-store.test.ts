import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mission } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { MAX_ARTIFACT_BYTES } from '../../../shared/axiom-contract/artifact-params'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from '../db/axiom-store'
import { ArtifactStore } from './artifact-store'

let root: string
let db: OrchestrationDb
let store: AxiomStore
let artifacts: ArtifactStore
const input = {
  missionId: mission.id,
  kind: 'evidence' as const,
  content: Buffer.from('evidence ✓'),
  mediaType: 'text/plain',
  related: ['T01'],
  createdBy: 'tester'
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-artifact-'))
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  store.insertMission(mission)
  artifacts = new ArtifactStore(store, root)
})
afterEach(async () => {
  db.close()
  await rm(root, { recursive: true, force: true })
})

describe('ArtifactStore', () => {
  it('round trips bytes and keeps repeated puts completely unchanged', async () => {
    const first = await artifacts.put(input)
    expect(first.id).toMatch(/^art_[a-f0-9]{64}$/)
    expect(first.sizeBytes).toBe(input.content.length)
    expect(await artifacts.read(first.id)).toEqual({ meta: first, content: input.content })
    expect(await artifacts.put({ ...input, related: ['different'], createdBy: 'other' })).toEqual(
      first
    )
    expect(artifacts.list({ missionId: mission.id })).toEqual([first])
    expect(await readdir(root)).toEqual([first.sha256])
  })
  it('deduplicates bytes across kinds and Missions, including concurrent puts', async () => {
    store.insertMission({
      ...mission,
      id: 'other',
      runId: 'other',
      coordinatorOrcaSessionId: 'other'
    })
    const [a, b, c] = await Promise.all([
      artifacts.put(input),
      artifacts.put({ ...input, kind: 'handoff' }),
      artifacts.put({ ...input, missionId: 'other' })
    ])
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(await readdir(root)).toEqual([a.sha256])
    expect(artifacts.list({ missionId: mission.id })).toHaveLength(2)
  })
  it('detects corruption and missing content without leaking bytes', async () => {
    const meta = await artifacts.put(input)
    await writeFile(artifacts.pathFor(meta.sha256), 'broken')
    await expect(artifacts.read(meta.id)).rejects.toMatchObject({ code: 'artifact_corrupt' })
    await rm(artifacts.pathFor(meta.sha256))
    await expect(artifacts.read(meta.id)).rejects.toMatchObject({ code: 'artifact_corrupt' })
    await expect(artifacts.read('missing')).rejects.toMatchObject({ code: 'artifact_not_found' })
    expect(() => artifacts.pathFor('../escape')).toThrow()
  })
  it('rejects oversized content and unknown Missions before writing', async () => {
    await expect(
      artifacts.put({ ...input, content: Buffer.alloc(MAX_ARTIFACT_BYTES + 1) })
    ).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(artifacts.put({ ...input, missionId: 'missing' })).rejects.toMatchObject({
      code: 'mission_not_found'
    })
    expect(await readdir(root)).toEqual([])
    expect(artifacts.list({ missionId: mission.id })).toEqual([])
  })
  it('filters by Mission, kind, and exact related id', async () => {
    const a = await artifacts.put(input)
    await artifacts.put({ ...input, kind: 'handoff', related: ['T010'] })
    expect(artifacts.list({ missionId: mission.id, kind: 'evidence', relatedTo: 'T01' })).toEqual([
      a
    ])
    expect(artifacts.list({ missionId: mission.id, relatedTo: 'T01' })).toEqual([a])
    expect(artifacts.list({ missionId: 'other' })).toEqual([])
    expect(await readFile(artifacts.pathFor(a.sha256))).toEqual(input.content)
  })
})
