import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { rpcFixture } from './rpc-fixture.test-support'
import { getAxiomControlPlane } from './control-plane'
import { createInput } from './mission-controller/controller-fixture.test-support'
import {
  makeProposal,
  provenance
} from '../../shared/axiom-contract/contract-fixtures.test-support'
import { PlanResponseSchema, PlanListResponseSchema } from '../../shared/axiom-contract/plan-params'

let f: ReturnType<typeof rpcFixture>
beforeEach(() => {
  f = rpcFixture()
})
afterEach(() => {
  f.db.close()
  vi.restoreAllMocks()
})

it('shows coverage from the stored plan Goal even after the active Goal changes; list keeps persisted warnings', async () => {
  const missions = getAxiomControlPlane(f.runtime).missions
  const { mission, goalRevision } = missions.createMission({
    ...createInput,
    goal: { ...createInput.goal, acceptanceCriteria: ['first', 'second'] }
  })
  const proposal = makeProposal()
  proposal.tasks[0].coversGoalCriteria = [0]
  const plan = missions.proposePlan({
    missionId: mission.id,
    planRevision: { ...proposal, goalRevisionId: goalRevision.id },
    provenance
  })
  const replacement = f.store.insertGoalRevision(
    { ...createInput.goal, acceptanceCriteria: ['changed'] },
    { missionId: mission.id, status: 'ACTIVE' }
  )
  f.store.setActiveRevisions({ id: mission.id, activeGoalRevisionId: replacement.id })
  const response = await f.call('axiom.plan.show', { planRevisionId: plan.id })
  expect(response.ok).toBe(true)
  if (!response.ok) {
    throw new Error('Plan show failed')
  }
  expect(PlanResponseSchema.parse(response.result)).toEqual({
    planRevision: plan,
    coverage: {
      criteria: [
        { index: 0, text: 'first', taskIds: ['T01'] },
        { index: 1, text: 'second', taskIds: [] }
      ],
      uncovered: [1]
    }
  })
  const list = await f.call('axiom.plan.list', { missionId: mission.id })
  expect(list.ok).toBe(true)
  if (!list.ok) {
    throw new Error('Plan list failed')
  }
  expect(PlanListResponseSchema.parse(list.result)).toEqual({ planRevisions: [plan] })
  expect(list.result).not.toHaveProperty('coverage')
})
