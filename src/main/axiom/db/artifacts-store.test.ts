import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from './axiom-store'
import type { ContextManifest } from '../../../shared/axiom-contract/context-package'

let db: OrchestrationDb
let store: AxiomStore
const artifact = {
  id: 'art_a',
  missionId: 'm',
  kind: 'handoff' as const,
  sha256: 'a'.repeat(64),
  sizeBytes: 3,
  mediaType: 'text/plain',
  related: ['T01'],
  createdBy: 'worker'
}
const manifest: ContextManifest = {
  version: 1,
  missionId: 'm',
  taskId: 'T04',
  planRevisionId: 'p',
  tokenBudget: 100,
  mandatory: [],
  ranked: [],
  omitted: []
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())

describe('artifact and context rows', () => {
  it('round trips immutable metadata, rejects bad cells and lists stable filtered rows', () => {
    expect(store.getArtifact('missing')).toBeUndefined()
    const first = store.insertArtifact(artifact)
    expect(store.getArtifact(artifact.id)).toEqual(first)
    expect(store.insertArtifact({ ...artifact, sizeBytes: 999, related: [] })).toEqual(first)
    store.insertArtifact({ ...artifact, id: 'art_b', kind: 'worker_report', related: ['T010'] })
    store.insertArtifact({ ...artifact, id: 'art_c', missionId: 'other' })
    expect(store.listArtifacts({ missionId: 'm' }).map((a) => a.id)).toEqual(['art_a', 'art_b'])
    expect(store.listArtifacts({ missionId: 'm', kind: 'handoff', relatedTo: 'T01' })).toEqual([
      first
    ])
    db.db.prepare('UPDATE artifacts SET related = ? WHERE id = ?').run('bad-json', artifact.id)
    expect(() => store.getArtifact(artifact.id)).toThrow('Invalid stored JSON in artifacts')
    expect(() => store.insertArtifact({ ...artifact, sha256: '../escape' })).toThrow()
  })

  it('round trips ContextPackages and artifact references, with conflict no-op', () => {
    expect(store.getContextPackage('missing')).toBeUndefined()
    const row = {
      id: 'ctx_a',
      missionId: 'm',
      taskId: 'T04',
      planRevisionId: 'p',
      manifest,
      tokenBudget: 100,
      mandatoryRefs: ['art_manifest', 'art_render'],
      rankedRefs: ['art_handoff']
    }
    const saved = store.insertContextPackage(row)
    expect(saved).toMatchObject(row)
    expect(store.getContextPackage(row.id)).toEqual(saved)
    expect(store.insertContextPackage({ ...row, mandatoryRefs: [] })).toEqual(saved)
    db.db
      .prepare('UPDATE context_packages SET manifest = ? WHERE id = ?')
      .run('{"version":2}', row.id)
    expect(() => store.getContextPackage(row.id)).toThrow('Invalid stored JSON in context_packages')
  })

  it('reads Decisions by Mission/status and validates JSON without leaking contents', () => {
    const insert = db.db.prepare(
      'INSERT INTO decisions (id, mission_id, status, title, options, resolution, authority, provenance) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    insert.run(
      'd1',
      'm',
      'ACCEPTED',
      'Use CLI',
      '[{"id":"cli"}]',
      'CLI only',
      'user',
      '{"actor":"henry"}'
    )
    insert.run('d2', 'm', 'PROPOSED', 'Pending', '[]', null, 'user', '{}')
    insert.run('d3', 'other', 'ACCEPTED', 'Other', '[]', null, 'user', '{}')
    expect(store.listDecisions({ missionId: 'm', status: 'ACCEPTED' })).toMatchObject([
      {
        id: 'd1',
        title: 'Use CLI',
        options: [{ id: 'cli' }],
        resolution: 'CLI only',
        provenance: { actor: 'henry' }
      }
    ])
    expect(store.listDecisions({ missionId: 'm' })).toHaveLength(2)
    db.db
      .prepare('UPDATE decisions SET options = ? WHERE id = ?')
      .run('sensitive-invalid-json', 'd1')
    expect(() => store.listDecisions({ missionId: 'm' })).toThrow(
      'Invalid stored JSON in decisions row d1 column options'
    )
  })
})
