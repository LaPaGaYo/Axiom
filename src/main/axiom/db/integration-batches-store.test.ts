import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
import { integrationBatchesStore } from './integration-batches-store'

let db: OrchestrationDb
let store: ReturnType<typeof integrationBatchesStore>
const input = {
  id: 'z-first',
  missionId: 'mission',
  baseCommit: 'a'.repeat(40),
  candidateIds: ['candidate'],
  status: 'APPLYING' as const
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = integrationBatchesStore(db)
})
afterEach(() => {
  db.close()
  vi.restoreAllMocks()
})

describe('IntegrationBatch persistence', () => {
  it('stores a batch and reads it back by id, by Mission, by status and by candidate', () => {
    const first = store.insertIntegrationBatch(input)
    const second = store.insertIntegrationBatch({
      ...input,
      id: 'a-second',
      candidateIds: ['second'],
      status: 'QUEUED'
    })
    store.insertIntegrationBatch({ ...input, id: 'other', missionId: 'other' })
    expect(first).toMatchObject({ ...input, mergeCommit: null, conflicts: [], approvalId: null })
    expect(store.getIntegrationBatch(first.id)).toEqual(first)
    expect(store.getIntegrationBatch('missing')).toBeUndefined()
    expect(store.listIntegrationBatches({ missionId: 'mission' })).toEqual([first, second])
    expect(store.listOpenIntegrationBatches('mission')).toEqual([first, second])
    expect(store.listIntegrationBatches({ missionId: 'mission', status: 'QUEUED' })).toEqual([
      second
    ])
    expect(
      store.listIntegrationBatches({ missionId: 'mission', candidateId: 'candidate' })
    ).toEqual([first])
    expect(store.listIntegrationBatches({ missionId: 'mission', candidateId: 'cand' })).toEqual([])
    const invalid = { ...input, id: 'invalid', status: 'TESTING' as const }
    // @ts-expect-error Runtime callers must also be refused before a write.
    expect(() => store.insertIntegrationBatch(invalid)).toThrow()
    expect(store.listIntegrationBatches({ missionId: 'mission' })).toEqual([first, second])
  })

  it('moves a batch only along a legal transition and only from the expected status', () => {
    store.insertIntegrationBatch(input)
    store.insertIntegrationBatch({ ...input, id: 'other', missionId: 'other' })
    db.db
      .prepare('UPDATE integration_batches SET updated_at = ? WHERE id = ?')
      .run('2000-01-01', input.id)
    const before = store.getIntegrationBatch(input.id)
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'APPLYING',
        status: 'PROMOTED'
      })
    ).toBe(false)
    expect(store.getIntegrationBatch(input.id)).toEqual(before)
    const move = {
      id: input.id,
      expectedStatus: 'APPLYING' as const,
      status: 'TESTING' as const,
      mergeCommit: 'b'.repeat(40)
    }
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'QUEUED',
        status: 'APPLYING'
      })
    ).toBe(false)
    expect(store.transitionIntegrationBatch({ ...move, id: 'missing' })).toBe(false)
    expect(store.getIntegrationBatch(input.id)).toEqual(before)
    expect(store.transitionIntegrationBatch(move)).toBe(true)
    const testing = store.getIntegrationBatch(input.id)
    expect(testing?.updatedAt).not.toBe(before?.updatedAt)
    expect(store.transitionIntegrationBatch(move)).toBe(false)
    expect(store.getIntegrationBatch(input.id)).toEqual(testing)
    expect(store.listOpenIntegrationBatches('mission')).toEqual([testing])
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'TESTING',
        status: 'FAILED'
      })
    ).toBe(true)
    expect(store.listOpenIntegrationBatches('mission')).toEqual([])
    expect(store.listOpenIntegrationBatches('other')).toHaveLength(1)
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'FAILED',
        status: 'SUPERSEDED'
      })
    ).toBe(false)
  })

  it('sets what a status carries and clears the merge commit when a batch is queued again', () => {
    const original = store.insertIntegrationBatch(input)
    const toTesting = {
      id: input.id,
      expectedStatus: 'APPLYING' as const,
      status: 'TESTING' as const
    }
    // @ts-expect-error The TESTING payload is required at runtime as well as in types.
    expect(() => store.transitionIntegrationBatch(toTesting)).toThrow()
    expect(store.getIntegrationBatch(input.id)).toEqual(original)
    expect(store.transitionIntegrationBatch({ ...toTesting, mergeCommit: 'b'.repeat(40) })).toBe(
      true
    )
    expect(store.getIntegrationBatch(input.id)?.mergeCommit).toBe('b'.repeat(40))
    // Recovery must clear old conflict evidence as well as the merge commit.
    db.db
      .prepare('UPDATE integration_batches SET conflicts = ? WHERE id = ?')
      .run('["old-path"]', input.id)
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'TESTING',
        status: 'QUEUED'
      })
    ).toBe(true)
    expect(store.getIntegrationBatch(input.id)).toMatchObject({ mergeCommit: null, conflicts: [] })
    const toApplying = {
      id: input.id,
      expectedStatus: 'QUEUED' as const,
      status: 'APPLYING' as const
    }
    expect(store.transitionIntegrationBatch({ ...toApplying, baseCommit: 'c'.repeat(40) })).toBe(
      true
    )
    expect(store.getIntegrationBatch(input.id)?.baseCommit).toBe('c'.repeat(40))
    expect(
      store.transitionIntegrationBatch({
        id: input.id,
        expectedStatus: 'APPLYING',
        status: 'QUEUED'
      })
    ).toBe(true)
    expect(store.transitionIntegrationBatch(toApplying)).toBe(true)
    expect(store.getIntegrationBatch(input.id)?.baseCommit).toBe('c'.repeat(40))
    const beforeConflict = store.getIntegrationBatch(input.id)
    const conflict = {
      id: input.id,
      expectedStatus: 'APPLYING' as const,
      status: 'CONFLICT' as const,
      conflicts: ['z.ts', 'a.ts']
    }
    expect(() => store.transitionIntegrationBatch({ ...conflict, conflicts: [] })).toThrow()
    const extra = { ...conflict, mergeCommit: 'b'.repeat(40) }
    expect(() => store.transitionIntegrationBatch(extra)).toThrow()
    expect(store.getIntegrationBatch(input.id)).toEqual(beforeConflict)
    expect(store.transitionIntegrationBatch(conflict)).toBe(true)
    expect(store.getIntegrationBatch(input.id)?.conflicts).toEqual(['z.ts', 'a.ts'])

    store.insertIntegrationBatch({ ...input, id: 'approval' })
    store.transitionIntegrationBatch({ ...toTesting, id: 'approval', mergeCommit: 'd'.repeat(64) })
    store.transitionIntegrationBatch({
      id: 'approval',
      expectedStatus: 'TESTING',
      status: 'PROMOTABLE'
    })
    const approval = {
      id: 'approval',
      expectedStatus: 'PROMOTABLE' as const,
      status: 'AWAITING_APPROVAL' as const
    }
    const beforeApproval = store.getIntegrationBatch('approval')
    // @ts-expect-error AWAITING_APPROVAL carries an approval id.
    expect(() => store.transitionIntegrationBatch(approval)).toThrow()
    expect(store.getIntegrationBatch('approval')).toEqual(beforeApproval)
    expect(store.transitionIntegrationBatch({ ...approval, approvalId: 'approval-id' })).toBe(true)
    expect(store.getIntegrationBatch('approval')?.approvalId).toBe('approval-id')
    expect(
      store.transitionIntegrationBatch({
        id: 'approval',
        expectedStatus: 'AWAITING_APPROVAL',
        status: 'REJECTED'
      })
    ).toBe(true)
    expect(store.getIntegrationBatch('approval')).toMatchObject({
      mergeCommit: 'd'.repeat(64),
      approvalId: 'approval-id'
    })
    expect(store.listOpenIntegrationBatches('mission')).toEqual([])
  })

  it('reports a stored batch that does not decode without quoting the cell', () => {
    const marker = ['private', Date.now().toString(36), 'cell'].join('-')
    db.db
      .prepare(`INSERT INTO integration_batches (id, mission_id, base_commit, candidate_ids, status)
      VALUES (?, ?, ?, ?, ?)`)
      .run(input.id, input.missionId, input.baseCommit, '["candidate"]', marker)
    const assertUnreadable = () => {
      for (const read of [
        () => store.getIntegrationBatch(input.id),
        () => store.listIntegrationBatches({ missionId: input.missionId }),
        () => store.listOpenIntegrationBatches(input.missionId)
      ]) {
        expect(read).toThrow()
        try {
          read()
        } catch (error) {
          expect(error).toBeInstanceOf(Error)
          if (error instanceof Error) {
            expect(error.message).not.toContain(marker)
          }
        }
      }
    }
    assertUnreadable()
    db.db
      .prepare('UPDATE integration_batches SET status = ?, candidate_ids = ? WHERE id = ?')
      .run('QUEUED', '["one","two"]', input.id)
    assertUnreadable()
    db.db
      .prepare('UPDATE integration_batches SET candidate_ids = ? WHERE id = ?')
      .run(marker, input.id)
    assertUnreadable()
    expect(() => store.getIntegrationBatch(input.id)).toThrow(
      /integration_batches.*z-first.*candidate_ids/
    )
    db.db
      .prepare('UPDATE integration_batches SET candidate_ids = ?, base_commit = ? WHERE id = ?')
      .run('["candidate"]', marker, input.id)
    assertUnreadable()
  })

  it('exposes the batch store through AxiomStore', () => {
    expect(new AxiomStore(db)).toMatchObject({
      insertIntegrationBatch: expect.any(Function),
      getIntegrationBatch: expect.any(Function),
      listIntegrationBatches: expect.any(Function),
      listOpenIntegrationBatches: expect.any(Function),
      transitionIntegrationBatch: expect.any(Function)
    })
    const axiom = new AxiomStore(db)
    const batch = axiom.insertIntegrationBatch(input)
    expect(axiom.getIntegrationBatch(batch.id)).toEqual(batch)
  })
})
