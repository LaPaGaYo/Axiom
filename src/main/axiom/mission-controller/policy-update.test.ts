import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from './mission-controller'
import { PolicyUpdateParams } from '../../../shared/axiom-contract/policy-params'
import {
  goal,
  policy,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'

let db: OrchestrationDb
let store: AxiomStore
let missions: MissionController
let missionId: string
const now = vi.fn(() => '2026-11-21T12:00:00.000Z')
const schedule = vi.fn()
const budgets = [{ maxRuntimeMinutes: 1 }, {}, null, 100, undefined]
const updates = () =>
  store.listAuditEvents({ missionId }).filter((row) => row.event === 'policy.updated')
const update = (patch: unknown, id = missionId) =>
  missions.updatePolicy(PolicyUpdateParams.parse({ missionId: id, patch }))

beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  missions = new MissionController(db, store, { now, onScheduleTrigger: schedule })
  missionId = missions.createMission({
    repoId: 'repo',
    repoPath: '/fixture',
    targetBranch: 'main',
    goal,
    policy,
    provenance
  }).mission.id
  now.mockClear()
  schedule.mockClear()
})
afterEach(() => {
  vi.restoreAllMocks()
  db.close()
})

it('updates the policy and records the old and the new one in the same write', () => {
  expect(missions.updatePolicy).toBeTypeOf('function')
  const before = store.getPolicy(missionId)
  const patch = PolicyUpdateParams.parse({
    missionId,
    patch: { concurrencyLimit: 2, routing: { preferredProviders: ['codex'] } }
  })
  const result = missions.updatePolicy(patch)
  const after = { ...before, ...patch.patch }
  expect(result).toEqual({ policy: after })
  expect(store.getPolicy(missionId)).toEqual(after)
  expect(updates()).toHaveLength(1)
  expect(updates()[0]).toMatchObject({
    actor: 'user',
    objectKind: 'policy',
    objectId: missionId,
    before,
    after
  })
  expect(now).not.toHaveBeenCalled()
  vi.spyOn(store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  expect(() => update({ concurrencyLimit: 1 })).toThrow('audit unavailable')
  expect(store.getPolicy(missionId)).toEqual(after)
  expect(updates()).toHaveLength(1)
})

it('refuses a budget key and an unsupported threshold and writes nothing', () => {
  expect(missions.updatePolicy).toBeTypeOf('function')
  const before = store.getPolicy(missionId)
  for (const budget of budgets) {
    expect(() => update({ budget, concurrencyLimit: 1 })).toThrow(
      expect.objectContaining({
        code: 'approval_required',
        message: 'Budget updates require Approval (M4)'
      })
    )
  }
  for (const patch of [
    { readinessThreshold: 'VERIFIED' },
    { readinessThreshold: 'VERIFIED', budget: {} }
  ]) {
    expect(() => update(patch)).toThrow(
      expect.objectContaining({
        code: 'invalid_argument',
        data: { reason: 'threshold_not_supported' }
      })
    )
  }
  expect(store.getPolicy(missionId)).toEqual(before)
  expect(updates()).toEqual([])
})

it('refuses a write to a Mission that does not exist', () => {
  expect(missions.updatePolicy).toBeTypeOf('function')
  for (const patch of [
    { concurrencyLimit: 2 },
    { concurrencyLimit: 2, readinessThreshold: 'INTEGRATED' }
  ]) {
    expect(() => update(patch, 'absent')).toThrow(
      expect.objectContaining({ code: 'mission_not_found', data: { missionId: 'absent' } })
    )
  }
  db.db.prepare('DELETE FROM mission_policies WHERE mission_id = ?').run(missionId)
  expect(() => update({})).toThrow(
    expect.objectContaining({ code: 'mission_not_found', data: { missionId } })
  )
  expect(updates()).toEqual([])
})

it('asks one round with the policy trigger after the write and none after a refusal', async () => {
  expect(missions.updatePolicy).toBeTypeOf('function')
  schedule.mockImplementation(() => {
    expect(db.db.isTransaction).toBe(false)
    expect(updates().at(-1)?.after).toEqual(store.getPolicy(missionId))
  })
  update({ concurrencyLimit: 2 })
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'policy')
  schedule.mockClear()
  for (const budget of budgets) {
    expect(() => update({ budget })).toThrow(expect.objectContaining({ code: 'approval_required' }))
  }
  expect(() => update({ readinessThreshold: 'VERIFIED' })).toThrow(
    expect.objectContaining({ code: 'invalid_argument' })
  )
  for (const patch of [{ concurrencyLimit: 2 }, { readinessThreshold: 'INTEGRATED' }]) {
    expect(() => update(patch, 'absent')).toThrow(
      expect.objectContaining({ code: 'mission_not_found' })
    )
  }
  expect(schedule).not.toHaveBeenCalled()
  const before = store.getPolicy(missionId)
  expect(() =>
    store.transaction('outer_policy_rollback', () => {
      update({ concurrencyLimit: 1 })
      expect(schedule).not.toHaveBeenCalled()
      throw new Error('outer rollback')
    })
  ).toThrow('outer rollback')
  await Promise.resolve()
  expect(schedule).not.toHaveBeenCalled()
  expect(store.getPolicy(missionId)).toEqual(before)
  store.transaction('outer_policy_commit', () => {
    update({ concurrencyLimit: 1 })
    expect(schedule).not.toHaveBeenCalled()
  })
  await Promise.resolve()
  expect(schedule).toHaveBeenCalledExactlyOnceWith(missionId, 'policy')
  schedule.mockClear()
  const audit = vi.spyOn(store, 'appendAuditEvent').mockImplementation(() => {
    throw new Error('audit unavailable')
  })
  expect(() => update({ concurrencyLimit: 2 })).toThrow('audit unavailable')
  audit.mockRestore()
  db.db.prepare('DELETE FROM mission_policies WHERE mission_id = ?').run(missionId)
  expect(() => update({})).toThrow(expect.objectContaining({ code: 'mission_not_found' }))
  expect(schedule).not.toHaveBeenCalled()
})
