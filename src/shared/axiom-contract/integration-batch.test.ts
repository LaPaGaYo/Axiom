import { describe, expect, it } from 'vitest'
import {
  INTEGRATION_BATCH_STATUSES,
  IntegrationBatchSchema,
  TERMINAL_INTEGRATION_BATCH_STATUSES,
  isLegalIntegrationBatchTransition
} from './integration-batch'

describe('IntegrationBatch contract', () => {
  it('admits exactly the IntegrationBatch transitions and nothing out of a terminal status', () => {
    const rows: Record<string, string[]> = {
      QUEUED: ['APPLYING', 'SUPERSEDED'],
      APPLYING: ['TESTING', 'CONFLICT', 'QUEUED', 'SUPERSEDED'],
      TESTING: ['PROMOTABLE', 'FAILED', 'QUEUED', 'SUPERSEDED'],
      PROMOTABLE: ['PROMOTED', 'AWAITING_APPROVAL', 'SUPERSEDED'],
      AWAITING_APPROVAL: ['PROMOTED', 'REJECTED', 'SUPERSEDED'],
      PROMOTED: [],
      CONFLICT: [],
      FAILED: [],
      REJECTED: [],
      SUPERSEDED: []
    }
    expect([...INTEGRATION_BATCH_STATUSES].sort()).toEqual(Object.keys(rows).sort())
    for (const from of INTEGRATION_BATCH_STATUSES) {
      for (const to of INTEGRATION_BATCH_STATUSES) {
        expect(isLegalIntegrationBatchTransition(from, to), `${from} → ${to}`).toBe(
          rows[from].includes(to)
        )
      }
    }
    expect([...TERMINAL_INTEGRATION_BATCH_STATUSES].sort()).toEqual([
      'CONFLICT',
      'FAILED',
      'PROMOTED',
      'REJECTED',
      'SUPERSEDED'
    ])
  })

  it('accepts a batch of exactly one candidate and refuses unknown fields and malformed commits', () => {
    const batch = {
      id: 'batch',
      missionId: 'mission',
      baseCommit: 'a'.repeat(40),
      candidateIds: ['candidate'],
      status: 'QUEUED',
      mergeCommit: null,
      conflicts: [],
      approvalId: null,
      createdAt: '2026-11-16',
      updatedAt: '2026-11-16'
    }
    expect(IntegrationBatchSchema.parse(batch)).toEqual(batch)
    for (const invalid of [
      { ...batch, extra: true },
      { ...batch, candidateIds: [] },
      { ...batch, candidateIds: ['one', 'two'] },
      { ...batch, baseCommit: 'a'.repeat(39) },
      { ...batch, mergeCommit: 'not-hex' },
      { ...batch, conflicts: [''] },
      { ...batch, status: 'OTHER' }
    ]) {
      expect(IntegrationBatchSchema.safeParse(invalid).success).toBe(false)
    }
    const longOid = { ...batch, baseCommit: 'b'.repeat(64), mergeCommit: 'c'.repeat(64) }
    expect(IntegrationBatchSchema.parse(longOid)).toEqual(longOid)
  })
})
