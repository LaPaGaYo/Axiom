import { afterEach, beforeEach, expect, it } from 'vitest'
import { plannerFixture } from './execution/planner-fixture.test-support'
import { createPlannerLauncher } from './execution/planner-launcher'
import {
  makeProposal,
  provenance
} from '../../shared/axiom-contract/contract-fixtures.test-support'

let f: Awaited<ReturnType<typeof plannerFixture>>
beforeEach(async () => {
  f = await plannerFixture()
})
afterEach(async () => {
  await f.close()
})
it.each([
  ['mission_not_found', 'mission_not_found'],
  ['mission_not_analyzing', 'illegal_transition'],
  ['plan_pending', 'plan_pending'],
  ['planner_active', 'invalid_argument'],
  ['no_eligible_provider', 'no_eligible_provider']
] as const)('mission.plan refuses %s without changing state', async (reason, code) => {
  if (reason === 'mission_not_analyzing') {
    f.missions.pauseMission(f.mission.id, 'review')
  }
  if (reason === 'plan_pending') {
    f.missions.proposePlan({
      missionId: f.mission.id,
      planRevision: { ...makeProposal(), goalRevisionId: f.goalRevision.id },
      provenance
    })
  }
  if (reason === 'planner_active') {
    await createPlannerLauncher(f.deps).start(f.mission.id)
  }
  const missionId = reason === 'mission_not_found' ? 'missing' : f.mission.id
  const before = f.store.listAuditEvents({ missionId: f.mission.id })
  const bindings = f.store.listAttemptBindings({ missionId: f.mission.id })
  const mission = f.missions.getMission(f.mission.id)
  expect(await f.call('axiom.mission.plan', { missionId })).toMatchObject({
    ok: false,
    error: { code }
  })
  expect(f.missions.getMission(f.mission.id)).toEqual(mission)
  expect(f.store.listAuditEvents({ missionId: f.mission.id })).toEqual(before)
  expect(f.store.listAttemptBindings({ missionId: f.mission.id })).toEqual(bindings)
})
it('preserves no-eligible-provider code and filtered details through the shared RPC mapper', async () => {
  expect(await f.call('axiom.mission.plan', { missionId: f.mission.id })).toMatchObject({
    ok: false,
    error: {
      code: 'no_eligible_provider',
      data: { filtered: expect.arrayContaining([{ provider: 'codex', reason: 'not_installed' }]) }
    }
  })
})
