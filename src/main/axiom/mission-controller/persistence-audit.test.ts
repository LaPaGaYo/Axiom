import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { provenance } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  actor,
  createInput,
  fixture,
  now,
  planned,
  propose,
  sessionId
} from './controller-fixture.test-support'
import { MissionController } from './mission-controller'
import { AxiomStore } from '../db/axiom-store'

let f: ReturnType<typeof fixture>
let directory: string | undefined
beforeEach(() => {
  f = fixture()
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
  if (directory) {
    rmSync(directory, { recursive: true, force: true })
    directory = undefined
  }
})

it('records the full ordered create/propose/approve/start audit with every required field', () => {
  const { mission, goalRevision, policy } = f.controller.createMission(createInput)
  const plan = propose(f.controller, mission.id, goalRevision.id)
  f.controller.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
  f.controller.startExecution(mission.id)
  const tasks = f.controller.listTasks({ missionId: mission.id })
  const creationOrder = [...tasks].sort((a, b) => a.spec.id.localeCompare(b.spec.id))
  const ready = tasks.filter((t) => t.stage === 'READY')
  const base = (
    objectKind: string,
    objectId: string,
    event: string,
    who: string,
    before: unknown,
    after: unknown
  ) => ({
    missionId: mission.id,
    actor: who,
    objectKind,
    objectId,
    event,
    before,
    after,
    createdAt: now()
  })
  const status = (from: string, to: string, who: string) =>
    base(
      'mission',
      mission.id,
      'mission.status',
      who,
      { status: from, previousStatus: null },
      { status: to, previousStatus: null, reason: null, restoring: false }
    )
  const expected = [
    base(
      'mission',
      mission.id,
      'mission.created',
      provenance.actor,
      null,
      expect.objectContaining({
        id: mission.id,
        runId: mission.runId,
        status: 'DRAFT',
        activeGoalRevisionId: null,
        policy,
        provenance
      })
    ),
    base('goal_revision', goalRevision.id, 'goal.activated', provenance.actor, null, goalRevision),
    status('DRAFT', 'ANALYZING', provenance.actor),
    base(
      'plan_revision',
      plan.id,
      'plan.proposed',
      provenance.actor,
      null,
      JSON.parse(JSON.stringify(plan))
    ),
    status('ANALYZING', 'PLAN_REVIEW', provenance.actor),
    base(
      'plan_revision',
      plan.id,
      'plan.approved',
      actor,
      { status: 'PROPOSED', activePlanRevisionId: null },
      { status: 'APPROVED', activePlanRevisionId: plan.id, provenance }
    ),
    ...creationOrder.map((t) =>
      base('task', t.taskId, 'task.created', actor, null, {
        taskId: t.taskId,
        missionId: mission.id,
        planRevisionId: plan.id,
        stage: 'DEFINED',
        previousStage: null,
        spec: t.spec,
        retryPolicy: t.retryPolicy,
        attemptCount: 0
      })
    ),
    base('plan_revision', plan.id, 'plan.materialized', actor, null, {
      taskIds: creationOrder.map((t) => t.taskId),
      edges: expect.arrayContaining(f.store.listTaskEdges(mission.id))
    }),
    status('PLAN_REVIEW', 'PLANNED', actor),
    status('PLANNED', 'EXECUTING', 'MissionController'),
    ...ready.map((t) =>
      base(
        'task',
        t.taskId,
        'task.stage',
        'MissionController',
        { stage: 'DEFINED', previousStage: null },
        { stage: 'READY', previousStage: null, reason: 'readiness' }
      )
    )
  ]
  const events = f.store.listAuditEvents({ missionId: mission.id })
  expect(events).toEqual(expected.map((event, index) => ({ ...event, sequence: index + 1 })))
})

it('reopens a PROPOSED plan, materializes persisted data, then reopens executing readiness', () => {
  directory = mkdtempSync(join(tmpdir(), 'axiom-m1-05-'))
  const file = join(directory, 'orchestration.db')
  f.db.close()
  f = fixture(file)
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const plan = propose(f.controller, mission.id, goalRevision.id)
  f.controller.pauseMission(mission.id)
  f.controller.blockMission(mission.id, 'wait during review')
  const run = f.db.getRun(mission.runId)
  f.db.close()
  f = fixture(file)
  const mintSessionId = vi.fn(() => {
    throw new Error('must not mint on restart')
  })
  const restored = new MissionController(f.db, f.store, { now, mintSessionId })
  restored.unblockMission(mission.id)
  restored.resumeMission(mission.id)
  expect(restored.getMission(mission.id)).toMatchObject({
    status: 'PLAN_REVIEW',
    coordinatorOrcaSessionId: sessionId
  })
  expect(f.store.getPlanRevision(plan.id)).toEqual(plan)
  restored.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
  restored.startExecution(mission.id)
  const projection = restored.getMission(mission.id)
  const tasks = restored.listTasks({ missionId: mission.id })
  const events = f.store.listAuditEvents({ missionId: mission.id })
  expect(mintSessionId).not.toHaveBeenCalled()
  f.db.close()
  f = fixture(file)
  expect(f.controller.getMission(mission.id)).toEqual(projection)
  expect(f.controller.listTasks({ missionId: mission.id })).toEqual(tasks)
  expect(f.controller.recomputeReadiness(mission.id)).toEqual([])
  expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
  expect(f.db.getRun(mission.runId)).toEqual(run)
})

it('detects a CAS race after reread, rolling back start and readiness together', () => {
  const { missionId } = planned(f)
  const competitor = new AxiomStore(f.db)
  const original = f.store.updateMissionStatus
  const before = f.controller.getMission(missionId)
  const events = f.store.listAuditEvents({ missionId })
  vi.spyOn(f.store, 'updateMissionStatus').mockImplementationOnce((input) => {
    // Synchronous SQLite serializes writers; inject the competing CAS precisely
    // between this controller read and write to exercise the stale write branch.
    expect(
      competitor.updateMissionStatus({ ...input, to: 'PAUSED', previousStatus: 'PLANNED' })
    ).toBe(true)
    return original(input)
  })
  expect(() => f.controller.startExecution(missionId)).toThrowError(
    expect.objectContaining({ code: 'stale_state' })
  )
  expect(f.controller.getMission(missionId)).toEqual(before)
  expect(f.store.listAuditEvents({ missionId })).toEqual(events)
})

it('rejects a revision CAS miss before materialization or audit', () => {
  const { mission, goalRevision } = f.controller.createMission(createInput)
  const plan = propose(f.controller, mission.id, goalRevision.id)
  const events = f.store.listAuditEvents({ missionId: mission.id })
  vi.spyOn(f.store, 'updatePlanRevisionStatus').mockReturnValueOnce(false)
  expect(() =>
    f.controller.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
  ).toThrowError(expect.objectContaining({ code: 'stale_state' }))
  expect(f.controller.listTasks({ missionId: mission.id })).toEqual([])
  expect(f.store.getPlanRevision(plan.id)).toEqual(plan)
  expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
})
