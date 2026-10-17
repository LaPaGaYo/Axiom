import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  goal,
  makeProposal,
  mission,
  policy
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { PolicySchema } from '../../../shared/axiom-contract/mission-objects'
import { TASK_STAGES } from '../../../shared/axiom-contract/lifecycle'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { runLifecycleWriteTransaction } from '../../runtime/orchestration/db/lifecycle-write-transaction-runner'
import { AxiomStore } from './axiom-store'

let db: OrchestrationDb
let store: AxiomStore
let runId: string
const planBody = makeProposal()
const edge = { fromTaskId: 'a', toTaskId: 'b', readinessThreshold: 'VERIFIED' as const }
const audit = {
  missionId: mission.id,
  actor: 'controller',
  objectKind: 'mission',
  objectId: mission.id,
  event: 'created',
  before: null,
  after: { status: 'DRAFT', nested: [1, true, null] }
}

function taskRecord() {
  const task = db.createTask({ spec: 'implement', deps: [], runId })
  const spec = { ...makeProposal().tasks[0], id: task.id }
  return {
    taskId: task.id,
    missionId: mission.id,
    planRevisionId: 'plan-1',
    stage: 'DEFINED' as const,
    previousStage: null,
    spec,
    retryPolicy: { maxAttempts: 2 },
    attemptCount: 0
  }
}

beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  runId = db.createRun({
    objective: 'store fixture',
    coordinatorHandle: 'term_fixture',
    coordinatorPaneKey: 'tab:fixture'
  }).id
})
afterEach(() => {
  vi.restoreAllMocks()
  db.close()
})

describe('AxiomStore missions', () => {
  it('round-trips Mission identity through all lookups and lists', () => {
    expect(store.getMission(mission.id)).toBeUndefined()
    expect(store.getMissionByRunId(mission.runId)).toBeUndefined()
    expect(store.getMissionBySessionId(mission.coordinatorOrcaSessionId)).toBeUndefined()
    store.insertMission(mission)
    const saved = store.getMission(mission.id)
    expect(saved).toMatchObject({
      ...mission,
      previousStatus: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String)
    })
    expect(store.getMissionByRunId(mission.runId)).toEqual(saved)
    expect(store.getMissionBySessionId(mission.coordinatorOrcaSessionId)).toEqual(saved)
    expect(store.listMissions({})).toEqual([saved])
    store.setActiveRevisions({
      id: mission.id,
      activeGoalRevisionId: 'g',
      activePlanRevisionId: 'p'
    })
    store.setActiveRevisions({ id: mission.id, activeGoalRevisionId: null })
    expect(store.getMission(mission.id)).toMatchObject({
      activeGoalRevisionId: null,
      activePlanRevisionId: 'p'
    })
  })
  it('paginates by created_at and id, including tied timestamps and combined filters', () => {
    for (const [id, repoId, status, createdAt] of [
      ['z', 'r', 'DRAFT', '2020-01-01 00:00:00'],
      ['a', 'r', 'DRAFT', '2021-01-01 00:00:00'],
      ['b', 'r', 'DRAFT', '2021-01-01 00:00:00'],
      ['c', 'other', 'DRAFT', '2021-01-01 00:00:00'],
      ['d', 'r', 'PAUSED', '2021-01-01 00:00:00']
    ] as const) {
      store.insertMission({
        ...mission,
        id,
        repoId,
        status,
        runId: id,
        coordinatorOrcaSessionId: id
      })
      db.db.prepare('UPDATE missions SET created_at = ? WHERE id = ?').run(createdAt, id)
    }
    expect(store.listMissions({ repoId: 'r', status: 'DRAFT', limit: 1 }).map((m) => m.id)).toEqual(
      ['z']
    )
    expect(
      store.listMissions({ repoId: 'r', status: 'DRAFT', cursor: 'z', limit: 1 }).map((m) => m.id)
    ).toEqual(['a'])
    expect(
      store.listMissions({ repoId: 'r', status: 'DRAFT', cursor: 'a' }).map((m) => m.id)
    ).toEqual(['b'])
    expect(store.listMissions({ cursor: 'missing' })).toEqual([])
  })
  it('rejects stale from without changing any Mission columns', () => {
    store.insertMission(mission)
    const before = store.getMission(mission.id)
    expect(
      store.updateMissionStatus({
        id: mission.id,
        from: 'EXECUTING',
        to: 'PAUSED',
        previousStatus: 'EXECUTING'
      })
    ).toBe(false)
    expect(store.getMission(mission.id)).toEqual(before)
  })
  it('CAS updates status, previousStatus and updated_at without enforcing transitions', () => {
    store.insertMission(mission)
    db.db
      .prepare("UPDATE missions SET updated_at = '2000-01-01 00:00:00' WHERE id = ?")
      .run(mission.id)
    expect(
      store.updateMissionStatus({
        id: mission.id,
        from: 'DRAFT',
        to: 'COMPLETED',
        previousStatus: 'DRAFT'
      })
    ).toBe(true)
    expect(store.getMission(mission.id)).toMatchObject({
      status: 'COMPLETED',
      previousStatus: 'DRAFT'
    })
    expect(store.getMission(mission.id)?.updatedAt).not.toBe('2000-01-01 00:00:00')
  })
})

describe('AxiomStore revisions', () => {
  it('round-trips goal JSON and allocates gap-free numbers per Mission', () => {
    expect(store.getGoalRevision('missing')).toBeUndefined()
    const first = store.insertGoalRevision(goal, { missionId: mission.id, status: 'PROPOSED' })
    const second = store.insertGoalRevision(goal, { missionId: mission.id, status: 'ACTIVE' })
    const other = store.insertGoalRevision(goal, { missionId: 'other', status: 'PROPOSED' })
    expect(first).toMatchObject({ ...goal, revision: 1, missionId: mission.id, status: 'PROPOSED' })
    expect(first.id).toMatch(/^goalrev_[a-f0-9]{12}$/)
    expect([second.revision, other.revision]).toEqual([2, 1])
    expect(store.getGoalRevision(first.id)).toEqual(first)
    expect(store.listGoalRevisions(mission.id)).toEqual([first, second])
    expect(store.updateGoalRevisionStatus({ id: first.id, from: 'ACTIVE', to: 'SUPERSEDED' })).toBe(
      false
    )
    expect(store.getGoalRevision(first.id)).toEqual(first)
    expect(store.updateGoalRevisionStatus({ id: first.id, from: 'PROPOSED', to: 'ACTIVE' })).toBe(
      true
    )
    expect(store.getGoalRevision(first.id)?.status).toBe('ACTIVE')
  })
  it('round-trips plans, supersession, rejection and independent revision numbering', () => {
    expect(store.getPlanRevision('missing')).toBeUndefined()
    const first = store.insertPlanRevision(planBody, { missionId: mission.id, status: 'PROPOSED' })
    const second = store.insertPlanRevision(planBody, {
      missionId: mission.id,
      status: 'APPROVED',
      supersedesId: first.id
    })
    const other = store.insertPlanRevision(planBody, { missionId: 'other', status: 'PROPOSED' })
    expect(first).toMatchObject({
      goalRevisionId: planBody.goalRevisionId,
      milestones: planBody.milestones,
      risks: planBody.risks,
      tasks: planBody.tasks,
      edges: planBody.edges,
      provenance: planBody.provenance
    })
    expect(first.id).toMatch(/^planrev_[a-f0-9]{12}$/)
    expect([first.revision, second.revision, other.revision]).toEqual([1, 2, 1])
    expect(second.supersedesId).toBe(first.id)
    expect(store.getPlanRevision(first.id)).toEqual(first)
    expect(store.listPlanRevisions(mission.id)).toEqual([first, second])
    expect(
      store.updatePlanRevisionStatus({
        id: first.id,
        from: 'APPROVED',
        to: 'REJECTED',
        rejectedReason: 'stale'
      })
    ).toBe(false)
    expect(store.getPlanRevision(first.id)).toEqual(first)
    expect(
      store.updatePlanRevisionStatus({
        id: first.id,
        from: 'PROPOSED',
        to: 'REJECTED',
        rejectedReason: 'scope'
      })
    ).toBe(true)
    expect(store.getPlanRevision(first.id)).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'scope'
    })
  })
  it('does not consume a revision number when the caller rolls back', () => {
    expect(() =>
      store.transaction('revision_rollback', () => {
        store.insertGoalRevision(goal, { missionId: mission.id, status: 'ACTIVE' })
        store.insertPlanRevision(planBody, { missionId: mission.id, status: 'APPROVED' })
        throw new Error('abort')
      })
    ).toThrow('abort')
    expect(
      store.insertGoalRevision(goal, { missionId: mission.id, status: 'ACTIVE' }).revision
    ).toBe(1)
    expect(
      store.insertPlanRevision(planBody, { missionId: mission.id, status: 'APPROVED' }).revision
    ).toBe(1)
  })
})

describe('AxiomStore Task graph', () => {
  it('round-trips task JSON, filters stages and applies attempt deltas only on a matching CAS', () => {
    const record = taskRecord()
    expect(store.getTaskStage(record.taskId)).toBeUndefined()
    store.insertTaskStage(record)
    const saved = store.getTaskStage(record.taskId)
    expect(saved).toMatchObject({ ...record, updatedAt: expect.any(String) })
    expect(store.listTaskStages({ missionId: mission.id })).toEqual([saved])
    expect(store.listTaskStages({ missionId: 'other' })).toEqual([])
    expect(store.listTaskStages({ missionId: mission.id, planRevisionId: 'other' })).toEqual([])
    expect(store.listTaskStages({ missionId: mission.id, stage: 'READY' })).toEqual([])
    expect(
      store.updateTaskStage({
        taskId: record.taskId,
        from: 'READY',
        to: 'RUNNING',
        attemptCountDelta: 1
      })
    ).toBe(false)
    expect(store.getTaskStage(record.taskId)).toEqual(saved)
    expect(
      store.updateTaskStage({
        taskId: record.taskId,
        from: 'DEFINED',
        to: 'RUNNING',
        previousStage: 'DEFINED',
        attemptCountDelta: 1
      })
    ).toBe(true)
    expect(store.getTaskStage(record.taskId)).toMatchObject({
      stage: 'RUNNING',
      previousStage: 'DEFINED',
      attemptCount: 1
    })
    expect(store.updateTaskStage({ taskId: record.taskId, from: 'RUNNING', to: 'BLOCKED' })).toBe(
      true
    )
    expect(store.getTaskStage(record.taskId)?.previousStage).toBe('DEFINED')
    expect(
      store.updateTaskStage({
        taskId: record.taskId,
        from: 'BLOCKED',
        to: 'READY',
        previousStage: null
      })
    ).toBe(true)
    expect(store.getTaskStage(record.taskId)?.previousStage).toBeNull()
    expect(
      store.listTaskStages({ missionId: mission.id, stage: 'READY', planRevisionId: 'plan-1' })
    ).toHaveLength(1)
  })
  it('zero-fills every stage using one aggregate query scoped to a Mission', () => {
    const a = taskRecord()
    const b = taskRecord()
    store.insertTaskStage(a)
    store.insertTaskStage(b)
    store.insertTaskStage({ ...taskRecord(), missionId: 'other' })
    store.updateTaskStage({ taskId: b.taskId, from: 'DEFINED', to: 'READY' })
    const prepare = vi.spyOn(db.db, 'prepare')
    const counts = store.countTaskStages(mission.id)
    expect(Object.keys(counts).sort()).toEqual([...TASK_STAGES].sort())
    expect(counts).toMatchObject({ DEFINED: 1, READY: 1, RUNNING: 0, INTEGRATED: 0 })
    expect(Object.values(counts).reduce((sum, n) => sum + n, 0)).toBe(2)
    expect(prepare).toHaveBeenCalledTimes(1)
    expect(prepare.mock.calls[0]?.[0]).toMatch(/GROUP BY stage/)
  })
  it('round-trips and directs edges; duplicate PK rolls the whole batch back', () => {
    const next = { ...edge, fromTaskId: 'b', toTaskId: 'c' }
    store.insertTaskEdges(mission.id, 'plan-1', [edge, next])
    expect(store.listTaskEdges(mission.id)).toEqual([edge, next])
    expect(store.listTaskEdges('other')).toEqual([])
    expect(store.listUpstreamEdges('b')).toEqual([edge])
    expect(store.listDownstreamEdges('b')).toEqual([next])
    expect(() =>
      store.insertTaskEdges(mission.id, 'plan-1', [{ ...edge, toTaskId: 'd' }, edge])
    ).toThrow()
    expect(store.listTaskEdges(mission.id)).toEqual([edge, next])
    expect(() => store.insertTaskEdges(mission.id, 'plan-1', [next, next])).toThrow()
    store.insertTaskEdges(mission.id, 'plan-1', [])
    expect(store.listTaskEdges(mission.id)).toHaveLength(2)
  })
})

describe('AxiomStore policy, audit and transactions', () => {
  it('upserts every policy field and preserves JSON', () => {
    expect(store.getPolicy(mission.id)).toBeUndefined()
    const value = PolicySchema.parse({
      ...policy,
      approvalRules: { high: { manual: true } },
      verificationRules: { commands: ['pnpm test'] }
    })
    store.upsertPolicy(mission.id, value)
    expect(store.getPolicy(mission.id)).toEqual(value)
    const changed = {
      ...value,
      concurrencyLimit: 5,
      budget: { maxTokens: 30 },
      unverifiableToleranceMinutes: 5,
      readinessThreshold: 'VERIFIED' as const,
      approvalRules: {},
      verificationRules: { checks: ['lint'] }
    }
    store.upsertPolicy(mission.id, changed)
    expect(store.getPolicy(mission.id)).toEqual(changed)
  })
  it('appends immutable audit events and pages by sequence within a Mission', () => {
    const sequence = store.appendAuditEvent({ ...audit, createdAt: '2026-10-17T12:00:00Z' })
    store.appendAuditEvent({ ...audit, missionId: 'other' })
    const second = store.appendAuditEvent({ ...audit, before: false, after: ['x', 1] })
    expect(second).toBeGreaterThan(sequence)
    expect(store.listAuditEvents({ missionId: mission.id, limit: 1 })).toEqual([
      { ...audit, sequence, createdAt: '2026-10-17T12:00:00Z' }
    ])
    expect(store.listAuditEvents({ missionId: mission.id, afterSequence: sequence })).toEqual([
      { ...audit, before: false, after: ['x', 1], sequence: second, createdAt: expect.any(String) }
    ])
  })
  it('nests in kernel transactions and rolls back only inner work after an inner throw', () => {
    runLifecycleWriteTransaction(db.db, 'outer', () => {
      store.insertMission(mission)
      expect(() =>
        store.transaction('inner', () => {
          store.insertGoalRevision(goal, { missionId: mission.id, status: 'PROPOSED' })
          store.appendAuditEvent(audit)
          throw new Error('inner failed')
        })
      ).toThrow('inner failed')
      expect(db.db.isTransaction).toBe(true)
      expect(store.getMission(mission.id)).toBeDefined()
      expect(store.listGoalRevisions(mission.id)).toEqual([])
      expect(store.listAuditEvents({ missionId: mission.id })).toEqual([])
      expect(store.transaction('successful', () => store.appendAuditEvent(audit))).toBe(1)
    })
    expect(db.db.isTransaction).toBe(false)
    expect(store.getMission(mission.id)).toBeDefined()
    expect(store.listAuditEvents({ missionId: mission.id })).toHaveLength(1)
  })
  it('enforces safe axiom-prefixed savepoints before executing a callback', () => {
    const exec = vi.spyOn(db.db, 'exec')
    runLifecycleWriteTransaction(db.db, 'outer', () => store.transaction('custom', () => 42))
    expect(exec).toHaveBeenCalledWith('SAVEPOINT axiom_custom')
    const callback = vi.fn()
    expect(() => store.transaction('bad; COMMIT', callback)).toThrow()
    expect(callback).not.toHaveBeenCalled()
  })
  it('rejects invalid enums before preparing SQL', () => {
    const record = taskRecord()
    const validPolicy = PolicySchema.parse(policy)
    const prepare = vi.spyOn(db.db, 'prepare')
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.insertMission({ ...mission, status: 'unknown' })
    }).toThrow()
    expect(() => {
      store.updateMissionStatus({
        id: mission.id,
        from: 'DRAFT',
        // @ts-expect-error Exercise an invalid enum from an untyped caller.
        to: 'unknown',
        previousStatus: null
      })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.insertGoalRevision(goal, { missionId: mission.id, status: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.insertPlanRevision(planBody, { missionId: mission.id, status: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.updateGoalRevisionStatus({ id: 'g', from: 'ACTIVE', to: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.updatePlanRevisionStatus({ id: 'p', from: 'APPROVED', to: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.insertTaskStage({ ...record, stage: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.updateTaskStage({ taskId: 't', from: 'READY', to: 'unknown' })
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise an invalid enum from an untyped caller.
      store.insertTaskEdges('m', 'p', [{ ...edge, readinessThreshold: 'READY' }])
    }).toThrow()
    expect(() => {
      // @ts-expect-error Exercise the permanently pinned depth from an untyped caller.
      store.upsertPolicy('m', { ...validPolicy, nestedWorkerMaxDepth: 2 })
    }).toThrow()
    expect(prepare).not.toHaveBeenCalled()
  })
  it.each(['{broken', '{"kind":"invalid"}'])(
    'names table, row and column for corrupted JSON: %s',
    (value) => {
      const revision = store.insertGoalRevision(goal, { missionId: mission.id, status: 'ACTIVE' })
      db.db.prepare('UPDATE goal_revisions SET provenance = ? WHERE id = ?').run(value, revision.id)
      expect(() => store.getGoalRevision(revision.id)).toThrow(
        `Invalid stored JSON in goal_revisions row ${revision.id} column provenance`
      )
    }
  )
  it('updates SQLite timestamps for every mutable table', () => {
    store.insertMission(mission)
    const g = store.insertGoalRevision(goal, { missionId: mission.id, status: 'ACTIVE' })
    const p = store.insertPlanRevision(planBody, { missionId: mission.id, status: 'APPROVED' })
    const task = taskRecord()
    store.insertTaskStage(task)
    store.upsertPolicy(mission.id, PolicySchema.parse(policy))
    for (const table of [
      'missions',
      'goal_revisions',
      'plan_revisions',
      'task_stages',
      'mission_policies'
    ]) {
      db.db.exec(`UPDATE ${table} SET updated_at = '2000-01-01 00:00:00'`)
    }
    store.setActiveRevisions({ id: mission.id, activeGoalRevisionId: g.id })
    store.updateGoalRevisionStatus({ id: g.id, from: 'ACTIVE', to: 'SUPERSEDED' })
    store.updatePlanRevisionStatus({ id: p.id, from: 'APPROVED', to: 'SUPERSEDED' })
    store.updateTaskStage({ taskId: task.taskId, from: 'DEFINED', to: 'READY' })
    store.upsertPolicy(mission.id, PolicySchema.parse(policy))
    for (const table of [
      'missions',
      'goal_revisions',
      'plan_revisions',
      'task_stages',
      'mission_policies'
    ]) {
      const row = z
        .object({ updated_at: z.string() })
        .parse(db.db.prepare(`SELECT updated_at FROM ${table}`).get())
      expect(row.updated_at).not.toBe('2000-01-01 00:00:00')
    }
  })
})
