import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  makeProposal,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { validatePlanProposal } from '../../../shared/axiom-contract/plan-proposal'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from './mission-controller'
import {
  actor,
  createInput,
  fixture,
  now,
  planned,
  propose,
  sessionId
} from './controller-fixture.test-support'

let f: ReturnType<typeof fixture>
beforeEach(() => {
  f = fixture()
})
afterEach(() => {
  vi.restoreAllMocks()
  f.db.close()
})

describe('Mission creation and plans', () => {
  it('creates an ACTIVE Goal, defaults and an ANALYZING Mission bound to a synthetic Run', () => {
    const { mission, goalRevision, policy } = f.controller.createMission(createInput)
    expect(mission).toMatchObject({
      status: 'ANALYZING',
      activeGoalRevisionId: goalRevision.id,
      coordinatorOrcaSessionId: sessionId
    })
    expect(goalRevision).toMatchObject({ revision: 1, status: 'ACTIVE', ...createInput.goal })
    expect(policy).toEqual({
      routing: {
        preferredProviders: [],
        disallowedProviders: [],
        highRiskTier: 'A',
        models: {},
        providerConcurrency: {},
        roles: {},
        crossProvider: true,
        requireCertified: false
      },
      concurrencyLimit: 3,
      budget: {},
      readinessThreshold: 'INTEGRATED',
      approvalRules: {},
      verificationRules: {},
      nestedWorkerMaxDepth: 1,
      unverifiableToleranceMinutes: 30
    })
    expect(f.db.getRun(mission.runId)).toMatchObject({
      objective: createInput.goal.objective,
      coordinator_handle: null,
      coordinator_pane_key: null,
      coordinator_orca_session_id: sessionId,
      consumer_generation: 1
    })
    expect(f.store.listAuditEvents({ missionId: mission.id }).map((e) => e.event)).toEqual([
      'mission.created',
      'goal.activated',
      'mission.status'
    ])
    expect(f.controller.listMissions({ repoId: 'repo', status: 'ANALYZING' })).toEqual([
      f.controller.getMission(mission.id)
    ])
    expect(f.controller.getMission(mission.id).countTaskStages).toMatchObject({
      READY: 0,
      DEFINED: 0
    })
  })

  it('rolls back the Run when a store fault occurs after createRun', () => {
    const createRun = vi.spyOn(f.db, 'createRun')
    vi.spyOn(f.store, 'insertMission').mockImplementation(() => {
      throw new Error('store fault')
    })
    expect(() => f.controller.createMission(createInput)).toThrow('store fault')
    const run = createRun.mock.results[0]?.value
    expect(run).toBeDefined()
    expect(f.db.getRun(run.id)).toBeUndefined()
    expect(f.store.listMissions({})).toEqual([])
  })

  it.each(['term_wrong', 'axiom:mission:wrong', ''])(
    'rejects invalid synthetic identity %s without a Run',
    (id) => {
      const createRun = vi.spyOn(f.db, 'createRun')
      const controller = new MissionController(f.db, f.store, { now, mintSessionId: () => id })
      expect(() => controller.createMission(createInput)).toThrowError(
        expect.objectContaining({ code: 'synthetic_session_id_invalid' })
      )
      expect(createRun).not.toHaveBeenCalled()
    }
  )

  it('refuses to reuse a Mission session without fencing its original Run', () => {
    const { mission } = f.controller.createMission(createInput)
    const before = f.db.getRun(mission.runId)
    expect(() => f.controller.createMission(createInput)).toThrowError(
      expect.objectContaining({ code: 'synthetic_session_id_invalid' })
    )
    expect(f.db.getRun(mission.runId)).toEqual(before)
  })

  it('persists the proposal before approval and refuses another pending proposal', () => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const plan = propose(f.controller, mission.id, goalRevision.id)
    expect(plan).toMatchObject({
      status: 'PROPOSED',
      tasks: makeProposal().tasks,
      edges: makeProposal().edges
    })
    expect(f.store.getPlanRevision(plan.id)).toEqual(plan)
    expect(f.controller.getMission(mission.id).status).toBe('PLAN_REVIEW')
    expect(f.controller.listTasks({ missionId: mission.id })).toEqual([])
    const events = f.store.listAuditEvents({ missionId: mission.id })
    expect(() => propose(f.controller, mission.id, goalRevision.id)).toThrowError(
      expect.objectContaining({ code: 'plan_pending' })
    )
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
  })

  it('rejects a cycle with its ids, leaving no revision or state change', () => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const proposal = makeProposal()
    proposal.edges.push({ fromTaskId: 'T04', toTaskId: 'T01', readinessThreshold: 'INTEGRATED' })
    expect(() => propose(f.controller, mission.id, goalRevision.id, proposal)).toThrowError(
      expect.objectContaining({
        code: 'plan_invalid',
        data: expect.objectContaining({
          errors: expect.arrayContaining([
            expect.objectContaining({
              code: 'cycle',
              taskIds: expect.arrayContaining(['T01', 'T04'])
            })
          ])
        })
      })
    )
    expect(f.controller.getMission(mission.id)).toEqual(mission)
    expect(f.store.listPlanRevisions(mission.id)).toEqual([])
    expect(f.store.listAuditEvents({ missionId: mission.id })).toHaveLength(3)
  })

  it('rejects a plan with a foreign Goal and an invalid schema', () => {
    const { mission } = f.controller.createMission(createInput)
    expect(() => propose(f.controller, mission.id, 'other')).toThrowError(
      expect.objectContaining({ code: 'plan_invalid' })
    )
    const proposal = makeProposal()
    proposal.tasks[0].retryPolicy.maxAttempts = 0
    expect(() => propose(f.controller, mission.id, 'other', proposal)).toThrowError(
      expect.objectContaining({ code: 'plan_invalid' })
    )
    expect(f.store.listPlanRevisions(mission.id)).toEqual([])
  })

  it('rejects a proposal with reason and permits a new numbered revision', () => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const first = propose(f.controller, mission.id, goalRevision.id)
    f.controller.rejectPlan({ planRevisionId: first.id, reason: 'scope', resolver: actor })
    expect(f.store.getPlanRevision(first.id)).toMatchObject({
      status: 'REJECTED',
      rejectedReason: 'scope'
    })
    expect(f.controller.getMission(mission.id).status).toBe('ANALYZING')
    expect(() =>
      f.controller.approvePlan({ planRevisionId: first.id, resolver: actor, provenance })
    ).toThrowError(expect.objectContaining({ code: 'plan_not_proposed' }))
    expect(propose(f.controller, mission.id, goalRevision.id).revision).toBe(2)
  })

  it('materializes in topological order with mapped edges, empty Orca deps and no lineage', () => {
    const proposal = makeProposal()
    proposal.tasks.reverse()
    const createTask = vi.spyOn(f.db, 'createTask')
    const { missionId, planId } = planned(f, proposal)
    const validation = validatePlanProposal(proposal)
    expect(validation.ok).toBe(true)
    if (!validation.ok) {
      throw new Error('Invalid test plan')
    }
    expect(createTask.mock.calls.map(([input]) => JSON.parse(input.spec).id)).toEqual(
      validation.order
    )
    const tasks = f.controller.listTasks({ missionId })
    expect(tasks).toHaveLength(12)
    for (const task of tasks) {
      expect(task).toMatchObject({
        stage: 'DEFINED',
        previousStage: null,
        orcaStatus: 'ready',
        attemptCount: 0,
        planRevisionId: planId
      })
      expect(task.title).toBe(task.spec.title)
      expect(f.db.getTask(task.taskId)).toMatchObject({
        deps: '[]',
        parent_id: null,
        created_by_terminal_handle: null,
        created_by_pane_key: null,
        created_by_process_incarnation: null,
        created_by_run_generation: null
      })
    }
    const mapping = new Map(tasks.map((t) => [t.spec.id, t.taskId]))
    const expected = proposal.edges.map((e) => ({
      ...e,
      fromTaskId: mapping.get(e.fromTaskId),
      toTaskId: mapping.get(e.toTaskId)
    }))
    expect(f.store.listTaskEdges(missionId)).toEqual(expect.arrayContaining(expected))
    expect(f.store.listTaskEdges(missionId)).toHaveLength(20)
    expect(f.controller.getMission(missionId)).toMatchObject({
      status: 'PLANNED',
      activePlanRevisionId: planId
    })
    expect(() =>
      f.controller.approvePlan({ planRevisionId: planId, resolver: actor, provenance })
    ).toThrowError(expect.objectContaining({ code: 'replan_not_supported' }))
    expect(f.controller.listTasks({ missionId })).toEqual(tasks)
  })

  it('rolls back approval, Tasks, stages, edges and audits on a late failure', () => {
    const { mission, goalRevision } = f.controller.createMission(createInput)
    const plan = propose(f.controller, mission.id, goalRevision.id)
    const events = f.store.listAuditEvents({ missionId: mission.id })
    const createTask = vi.spyOn(f.db, 'createTask')
    vi.spyOn(f.store, 'insertTaskEdges').mockImplementation(() => {
      throw new Error('edges fault')
    })
    expect(() =>
      f.controller.approvePlan({ planRevisionId: plan.id, resolver: actor, provenance })
    ).toThrow('edges fault')
    expect(createTask).toHaveBeenCalledTimes(12)
    for (const result of createTask.mock.results) {
      expect(f.db.getTask(result.value.id)).toBeUndefined()
    }
    expect(f.store.getPlanRevision(plan.id)?.status).toBe('PROPOSED')
    expect(f.controller.getMission(mission.id).status).toBe('PLAN_REVIEW')
    expect(f.controller.listTasks({ missionId: mission.id })).toEqual([])
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
  })

  it('starts only the three roots and rejects a second controller start as stale', () => {
    const { missionId } = planned(f)
    f.controller.startExecution(missionId)
    const tasks = f.controller.listTasks({ missionId, stage: 'READY' })
    expect(tasks.map((t) => t.spec.id).sort()).toEqual(['T01', 'T02', 'T03'])
    const second = new MissionController(f.db, new AxiomStore(f.db), { now })
    const before = f.controller.getMission(missionId)
    const events = f.store.listAuditEvents({ missionId })
    expect(() => second.startExecution(missionId)).toThrowError(
      expect.objectContaining({ code: 'stale_state' })
    )
    expect(f.controller.getMission(missionId)).toEqual(before)
    expect(f.store.listAuditEvents({ missionId })).toEqual(events)
  })
})
