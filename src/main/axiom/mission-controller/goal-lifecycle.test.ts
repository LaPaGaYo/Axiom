import { afterEach, expect, it, vi } from 'vitest'
import { goal } from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { fixture, createInput, planned, propose } from './controller-fixture.test-support'

const fixtures: ReturnType<typeof fixture>[] = []
function harness() {
  const f = fixture()
  fixtures.push(f)
  return f
}
afterEach(() => {
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
})

it('records an executing Goal change as MAJOR_REPLAN while preserving the prior approved plan', () => {
  const f = planned(harness())
  f.controller.startExecution(f.missionId)
  const previous = f.controller.getMission(f.missionId)
  const revision = f.controller.proposeGoal({
    missionId: f.missionId,
    goal: { ...goal, objective: 'Revised objective' }
  })
  f.controller.activateGoal({ missionId: f.missionId, goalRevisionId: revision.id })
  expect(f.controller.getMission(f.missionId)).toMatchObject({
    status: 'REPLANNING',
    activeGoalRevisionId: revision.id,
    activePlanRevisionId: previous.activePlanRevisionId
  })
  expect(f.controller.recomputeReadiness(f.missionId)).toEqual([])
  expect(f.controller.getPlan(f.planId).status).toBe('APPROVED')
  expect(f.store.listAuditEvents({ missionId: f.missionId }).at(-1)).toMatchObject({
    event: 'goal.activated',
    actor: 'user',
    after: { replanLevel: 'MAJOR_REPLAN' }
  })
})

it('refuses to activate a different Goal under a pending initial Plan', () => {
  const f = harness()
  const created = f.controller.createMission(createInput)
  const revision = f.controller.proposeGoal({ missionId: created.mission.id, goal })
  propose(f.controller, created.mission.id, created.goalRevision.id)
  expect(() =>
    f.controller.activateGoal({ missionId: created.mission.id, goalRevisionId: revision.id })
  ).toThrow('illegal_transition')
  expect(
    f.controller.getGoal({ missionId: created.mission.id, goalRevisionId: revision.id }).status
  ).toBe('PROPOSED')
  expect(f.controller.getMission(created.mission.id).activeGoalRevisionId).toBe(
    created.goalRevision.id
  )
})

it('rolls back both Goal statuses, active pointer and Run objective if final audit fails', () => {
  const f = harness()
  const created = f.controller.createMission(createInput)
  const revision = f.controller.proposeGoal({
    missionId: created.mission.id,
    goal: { ...goal, objective: 'Changed' }
  })
  const priorAudit = f.store.listAuditEvents({ missionId: created.mission.id })
  const append = f.store.appendAuditEvent.bind(f.store)
  vi.spyOn(f.store, 'appendAuditEvent').mockImplementation((event) => {
    if (event.event === 'goal.activated') {
      throw new Error('audit unavailable')
    }
    return append(event)
  })
  expect(() =>
    f.controller.activateGoal({ missionId: created.mission.id, goalRevisionId: revision.id })
  ).toThrow('audit unavailable')
  expect(f.store.getGoalRevision(revision.id)?.status).toBe('PROPOSED')
  expect(f.store.getGoalRevision(created.goalRevision.id)?.status).toBe('ACTIVE')
  expect(f.controller.getMission(created.mission.id).activeGoalRevisionId).toBe(
    created.goalRevision.id
  )
  expect(f.db.getRun(created.mission.runId)?.objective).toBe(goal.objective)
  expect(f.store.listAuditEvents({ missionId: created.mission.id })).toEqual(priorAudit)
})

it('rejects Goal proposals after cancellation', () => {
  const f = harness(),
    created = f.controller.createMission(createInput)
  f.controller.cancelMission(created.mission.id, 'stop')
  expect(() => f.controller.proposeGoal({ missionId: created.mission.id, goal })).toThrow(
    'illegal_transition'
  )
  expect(f.store.listGoalRevisions(created.mission.id)).toHaveLength(1)
})
