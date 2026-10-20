import { afterEach, beforeEach, expect, it } from 'vitest'
import { plannerFixture } from './execution/planner-fixture.test-support'
import { createPlannerLauncher } from './execution/planner-launcher'
import { makeProposal, provenance } from '../../shared/axiom-contract/contract-fixtures.test-support'

let f: Awaited<ReturnType<typeof plannerFixture>>
beforeEach(async () => { f = await plannerFixture() })
afterEach(async () => { await f.close() })
it.each(['mission_not_analyzing', 'plan_pending', 'planner_active', 'no_eligible_provider'] as const)(
  'mission.plan refuses %s without changing state', async (reason) => {
    if (reason === 'mission_not_analyzing') f.missions.pauseMission(f.mission.id, 'review')
    if (reason === 'plan_pending') f.missions.proposePlan({
      missionId: f.mission.id, planRevision: { ...makeProposal(), goalRevisionId: f.goalRevision.id }, provenance
    })
    if (reason === 'planner_active') await createPlannerLauncher(f.deps).start(f.mission.id)
    const before = f.store.listAuditEvents({ missionId: f.mission.id })
    const bindings = f.store.listAttemptBindings({ missionId: f.mission.id })
    expect(await f.call('axiom.mission.plan', { missionId: f.mission.id })).toMatchObject({
      ok: false, error: { code: 'invalid_argument', message: reason }
    })
    expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(before)
    expect(f.store.listAttemptBindings({ missionId: f.mission.id })).toEqual(bindings)
  }
)
it('preserves no-eligible-provider reason and filtered details through the shared RPC mapper', async () => {
  expect(await f.call('axiom.mission.plan', { missionId: f.mission.id })).toMatchObject({
    ok: false, error: { data: { reason: 'no_eligible_provider', filtered: expect.any(Array) } }
  })
})
