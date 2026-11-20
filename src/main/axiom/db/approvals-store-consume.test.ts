import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
import { sha256 } from '../artifacts/artifact-store'

let db: OrchestrationDb
let store: AxiomStore
const input = {
  id: 'approval',
  missionId: 'mission',
  actionKind: 'delivery' as const,
  inputsHash: sha256('report'),
  risk: 'high',
  expiresAt: '2099-01-01',
  requestedBy: 'MissionController'
}
const consumption = {
  id: input.id,
  outcome: 'fast_forwarded',
  executedAt: '2026-11-20T12:00:00.000Z'
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  store.insertApproval(input)
})
afterEach(() => db.close())

it('a GRANTED approval is consumed once with its outcome and execution time and keeps its resolver', () => {
  store.transitionApproval({
    id: input.id,
    expectedStatus: 'PENDING',
    status: 'GRANTED',
    resolver: 'user',
    resolution: 'granted'
  })
  expect(store).toHaveProperty('consumeApproval')
  expect(store.consumeApproval(consumption)).toBe(true)
  const consumed = store.getApproval(input.id)
  expect(consumed).toMatchObject({
    ...consumption,
    status: 'CONSUMED',
    updatedAt: consumption.executedAt,
    resolver: 'user',
    resolution: 'granted'
  })
  expect(store.consumeApproval({ ...consumption, outcome: 'up_to_date' })).toBe(false)
  expect(store.getApproval(input.id)).toEqual(consumed)
})

it('an approval that is not GRANTED is not consumed and has no outcome and no execution time', () => {
  expect(store).toHaveProperty('consumeApproval')
  for (const status of ['PENDING', 'DENIED', 'EXPIRED', 'REVOKED'] as const) {
    const approval = store.insertApproval({ ...input, id: status })
    if (status !== 'PENDING') {
      store.transitionApproval({ id: approval.id, expectedStatus: 'PENDING', status })
    }
    const before = store.getApproval(approval.id)
    expect(store.consumeApproval({ ...consumption, id: approval.id })).toBe(false)
    expect(store.getApproval(approval.id)).toEqual(before)
    expect(before).not.toHaveProperty('outcome')
    expect(before).not.toHaveProperty('executedAt')
  }
  expect(store.consumeApproval({ ...consumption, id: 'missing' })).toBe(false)
})
