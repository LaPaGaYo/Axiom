import { afterEach, beforeEach, expect, it } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db'
import { AxiomStore } from './axiom-store'
import { sha256 } from '../artifacts/artifact-store'

let db: OrchestrationDb
let store: AxiomStore
const input = {
  id: 'z-first',
  missionId: 'mission',
  actionKind: 'delivery' as const,
  inputsHash: sha256('completion report'),
  risk: 'high',
  expiresAt: '2026-11-22T12:00:00.000Z',
  requestedBy: 'MissionController'
}
beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
})
afterEach(() => db.close())

it('an inserted approval is PENDING and reads back with every field', () => {
  const approval = store.insertApproval(input)
  expect(approval).toEqual({
    ...input,
    status: 'PENDING',
    resolver: null,
    resolution: null,
    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })
  expect(store.getApproval(input.id)).toEqual(approval)
  expect(store.getApproval('missing')).toBeUndefined()
  const invalid = { ...input, id: 'extra', status: 'GRANTED' }
  expect(() => store.insertApproval(invalid)).toThrow()
})

it('a transition moves a row only from the expected status and only along a legal move', () => {
  store.insertApproval(input)
  const other = store.insertApproval({ ...input, id: 'other' })
  db.db.prepare('UPDATE approvals SET updated_at = ? WHERE id = ?').run('2000-01-01', input.id)
  const before = store.getApproval(input.id)
  expect(
    store.transitionApproval({ id: input.id, expectedStatus: 'PENDING', status: 'CONSUMED' })
  ).toBe(false)
  expect(
    store.transitionApproval({ id: input.id, expectedStatus: 'GRANTED', status: 'CONSUMED' })
  ).toBe(false)
  expect(
    store.transitionApproval({ id: 'missing', expectedStatus: 'PENDING', status: 'GRANTED' })
  ).toBe(false)
  expect(store.getApproval(input.id)).toEqual(before)
  const move = { id: input.id, expectedStatus: 'PENDING' as const, status: 'GRANTED' as const }
  expect(store.transitionApproval(move)).toBe(true)
  expect(store.getApproval(input.id)?.status).toBe('GRANTED')
  expect(store.getApproval(input.id)?.updatedAt).not.toBe(before?.updatedAt)
  expect(store.transitionApproval(move)).toBe(false)
  expect(
    store.transitionApproval({ id: input.id, expectedStatus: 'GRANTED', status: 'CONSUMED' })
  ).toBe(true)
  expect(
    store.transitionApproval({ id: input.id, expectedStatus: 'CONSUMED', status: 'REVOKED' })
  ).toBe(false)
  expect(store.getApproval(other.id)).toEqual(other)
})

it('a transition records the resolver and the resolution it was given', () => {
  store.insertApproval(input)
  expect(
    store.transitionApproval({
      id: input.id,
      expectedStatus: 'PENDING',
      status: 'GRANTED',
      resolver: 'tester',
      resolution: 'approved'
    })
  ).toBe(true)
  expect(store.getApproval(input.id)).toMatchObject({ resolver: 'tester', resolution: 'approved' })
  store.transitionApproval({ id: input.id, expectedStatus: 'GRANTED', status: 'CONSUMED' })
  expect(store.getApproval(input.id)).toMatchObject({ resolver: 'tester', resolution: 'approved' })
})

it('the list narrows by action kind and by status and keeps the order of creation', () => {
  const first = store.insertApproval(input)
  const second = store.insertApproval({ ...input, id: 'a-second', actionKind: 'budget_increase' })
  store.insertApproval({ ...input, id: 'third' })
  store.transitionApproval({ id: 'third', expectedStatus: 'PENDING', status: 'REVOKED' })
  const third = store.getApproval('third')
  store.insertApproval({ ...input, id: 'other', missionId: 'other' })
  // Tie all creation timestamps so rowid, rather than id, decides their order.
  db.db
    .prepare('UPDATE approvals SET created_at = ? WHERE mission_id = ?')
    .run(first.createdAt, input.missionId)
  expect(store.listApprovals({ missionId: input.missionId }).map((row) => row.id)).toEqual([
    first.id,
    second.id,
    'third'
  ])
  expect(
    store.listApprovals({ missionId: input.missionId, actionKind: 'delivery' }).map((row) => row.id)
  ).toEqual([first.id, 'third'])
  expect(store.listApprovals({ missionId: input.missionId, status: 'REVOKED' })).toEqual([
    { ...third, createdAt: first.createdAt }
  ])
  expect(
    store.listApprovals({ missionId: input.missionId, actionKind: 'delivery', status: 'PENDING' })
  ).toEqual([first])
  expect(
    store.listApprovals({
      missionId: input.missionId,
      actionKind: 'budget_increase',
      status: 'REVOKED'
    })
  ).toEqual([])
})

it('a row written by hand with a date as its expiry decodes', () => {
  db.db
    .prepare(`INSERT INTO approvals
    (id, mission_id, action_kind, inputs_hash, risk, status, expires_at, requested_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      'approval',
      'mission',
      'budget_increase',
      'hash',
      'high',
      'PENDING',
      '2099-01-01',
      'fixture'
    )
  expect(store.getApproval('approval')).toMatchObject({
    id: 'approval',
    missionId: 'mission',
    actionKind: 'budget_increase',
    inputsHash: 'hash',
    risk: 'high',
    status: 'PENDING',
    expiresAt: '2099-01-01',
    requestedBy: 'fixture',
    resolver: null,
    resolution: null
  })
  const marker = ['private', 'cell', input.inputsHash].join('-')
  db.db.prepare('UPDATE approvals SET status = ? WHERE id = ?').run(marker, 'approval')
  for (const read of [
    () => store.getApproval('approval'),
    () => store.listApprovals({ missionId: 'mission' })
  ]) {
    expect(read).toThrow('Invalid stored row in approvals')
    try {
      read()
    } catch (error) {
      expect(error).toBeInstanceOf(Error)
      if (error instanceof Error) {
        expect(error.message).not.toContain(marker)
      }
    }
  }
})
