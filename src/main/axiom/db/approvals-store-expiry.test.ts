import { expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { APPROVAL_STATUSES } from '../../../shared/axiom-contract/approval'
import { AxiomStore } from './axiom-store'
import { sha256 } from '../artifacts/artifact-store'

it('the expiry of a PENDING or GRANTED approval can be moved and a closed approval keeps its expiry', () => {
  const db = new OrchestrationDb(':memory:')
  const store = new AxiomStore(db)
  try {
    for (const status of APPROVAL_STATUSES) {
      const { id } = store.insertApproval({
        id: `approval-${status}`,
        missionId: 'mission',
        actionKind: 'delivery',
        inputsHash: sha256('completion report'),
        risk: 'high',
        requestedBy: 'MissionController',
        expiresAt: '2099-01-01'
      })
      if (status === 'CONSUMED') {
        store.transitionApproval({ id, expectedStatus: 'PENDING', status: 'GRANTED' })
        store.transitionApproval({ id, expectedStatus: 'GRANTED', status })
      } else if (status !== 'PENDING') {
        store.transitionApproval({ id, expectedStatus: 'PENDING', status })
      }
      db.db.prepare('UPDATE approvals SET updated_at = ? WHERE id = ?').run('2000-01-01', id)
      const before = store.getApproval(id)
      const expiresAt = '2099-01-02T00:00:00.000Z'
      const open = status === 'PENDING' || status === 'GRANTED'
      expect(store.updateApprovalExpiry({ id, expiresAt })).toBe(open)
      const after = store.getApproval(id)
      if (open) {
        expect(after).toMatchObject({ ...before, expiresAt, updatedAt: expect.any(String) })
        expect(after?.updatedAt).not.toBe(before?.updatedAt)
      } else {
        expect(after).toEqual(before)
      }
    }
    expect(store.updateApprovalExpiry({ id: 'missing', expiresAt: '2099-01-02' })).toBe(false)
  } finally {
    db.close()
  }
})
