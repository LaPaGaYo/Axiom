import { afterEach, expect, it, vi } from 'vitest'
import {
  MissionCreateResponseSchema,
  MissionListResponseSchema
} from '../../shared/axiom-contract/mission-params'
import { PlanResponseSchema, PlanListResponseSchema } from '../../shared/axiom-contract/plan-params'
import { TaskListResponseSchema, TaskResponseSchema } from '../../shared/axiom-contract/task-params'
import {
  makeProposal,
  provenance
} from '../../shared/axiom-contract/contract-fixtures.test-support'
import { getAxiomControlPlane } from './control-plane'
import { rpcFixture, createParams } from './rpc-fixture.test-support'
import type { RpcResponse } from '../runtime/rpc/core'
import { OrcaRuntimeService } from '../runtime/orca-runtime'
import {
  MISSION_CONTROLLER_ERROR_CODES,
  MissionControllerError
} from './mission-controller/controller-context'
import { mapRuntimeError } from '../runtime/rpc/errors'

const fixtures: ReturnType<typeof rpcFixture>[] = []
afterEach(() => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
})
function fixture() {
  const f = rpcFixture()
  fixtures.push(f)
  return f
}
function result(response: RpcResponse): unknown {
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error(response.error.code)
  }
  return response.result
}

it('caches one Control Plane per database, including across runtime wrappers', () => {
  const f = fixture(),
    other = fixture()
  const runtime = new OrcaRuntimeService()
  runtime.setOrchestrationDb(f.db)
  expect(getAxiomControlPlane(f.runtime)).toBe(getAxiomControlPlane(runtime))
  expect(getAxiomControlPlane(other.runtime)).not.toBe(getAxiomControlPlane(runtime))
})

it('reads revisions and Task stage projections and routes cancellation, pause and resume', async () => {
  const f = fixture()
  const { mission, goalRevision } = MissionCreateResponseSchema.parse(
    result(await f.call('axiom.mission.create', createParams))
  )
  expect(
    MissionListResponseSchema.parse(
      result(await f.call('axiom.mission.list', { repo: 'fixture', status: 'ANALYZING' }))
    ).missions.map((m) => m.id)
  ).toEqual([mission.id])
  expect(f.runtime.showRepo).toHaveBeenLastCalledWith('fixture')
  const input = {
    missionId: mission.id,
    planRevision: { ...makeProposal(), goalRevisionId: goalRevision.id },
    provenance
  }
  const first = PlanResponseSchema.parse(
    result(await f.call('axiom.plan.propose', input))
  ).planRevision
  expect(
    result(
      await f.call('axiom.plan.reject', {
        planRevisionId: first.id,
        resolver: 'user',
        reason: 'revise'
      })
    )
  ).toMatchObject({ planRevision: { status: 'REJECTED' } })
  const plan = PlanResponseSchema.parse(
    result(await f.call('axiom.plan.propose', input))
  ).planRevision
  expect(
    PlanListResponseSchema.parse(result(await f.call('axiom.plan.list', { missionId: mission.id })))
      .planRevisions
  ).toHaveLength(2)
  expect(
    PlanResponseSchema.parse(result(await f.call('axiom.plan.show', { planRevisionId: plan.id })))
      .planRevision
  ).toEqual(plan)
  result(await f.call('axiom.plan.approve', { planRevisionId: plan.id, resolver: 'user' }))
  result(await f.call('axiom.mission.start', { missionId: mission.id }))
  const tasks = TaskListResponseSchema.parse(
    result(await f.call('axiom.task.list', { missionId: mission.id, stage: 'READY' }))
  ).tasks
  expect(tasks).toHaveLength(3)
  expect(
    TaskResponseSchema.parse(result(await f.call('axiom.task.show', { taskId: tasks[0].id }))).task
  ).toEqual(tasks[0])
  expect(
    result(await f.call('axiom.task.cancel', { taskId: tasks[0].id, rationale: 'obsolete' }))
  ).toMatchObject({ task: { id: tasks[0].id, stage: 'CANCELED' } })
  expect(
    result(await f.call('axiom.mission.pause', { missionId: mission.id, reason: 'break' }))
  ).toMatchObject({ mission: { status: 'PAUSED' } })
  expect(
    result(await f.call('axiom.mission.resume', { missionId: mission.id, reason: 'continue' }))
  ).toMatchObject({ mission: { status: 'EXECUTING' } })
  expect(
    f.store
      .listAuditEvents({ missionId: mission.id })
      .some((e) => JSON.stringify(e.after).includes('continue'))
  ).toBe(true)
  expect(
    result(await f.call('axiom.mission.cancel', { missionId: mission.id, reason: 'stop' }))
  ).toMatchObject({ mission: { status: 'CANCELED' } })
  expect(
    f.store.listTaskStages({ missionId: mission.id }).every((t) => t.stage === 'CANCELED')
  ).toBe(true)
})

it('rejects malformed params before creating a Mission and validates the DAG through the controller', async () => {
  const f = fixture()
  expect(await f.call('axiom.mission.create', { ...createParams, goal: null })).toMatchObject({
    ok: false,
    error: { code: 'invalid_argument' }
  })
  expect(f.store.listMissions({})).toEqual([])
  const created = MissionCreateResponseSchema.parse(
    result(await f.call('axiom.mission.create', createParams))
  )
  const proposal = makeProposal()
  proposal.edges.push({ fromTaskId: 'T12', toTaskId: 'T01', readinessThreshold: 'INTEGRATED' })
  expect(
    await f.call('axiom.plan.propose', {
      missionId: created.mission.id,
      planRevision: { ...proposal, goalRevisionId: created.goalRevision.id },
      provenance
    })
  ).toMatchObject({ ok: false, error: { code: 'plan_invalid' } })
  expect(f.store.listPlanRevisions(created.mission.id)).toEqual([])
})

it.each(MISSION_CONTROLLER_ERROR_CODES)('maps %s with structured controller data', (code) => {
  const data = { missionId: 'm1' }
  expect(
    mapRuntimeError('rpc', { runtimeId: 'runtime' }, new MissionControllerError(code, data))
  ).toMatchObject({ ok: false, error: { code, data } })
})
