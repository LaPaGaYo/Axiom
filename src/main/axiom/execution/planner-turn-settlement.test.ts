import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { plannerFixture } from './planner-fixture.test-support'
import { createPlannerLauncher } from './planner-launcher'
import { settleClaudePlannerTurn } from './planner-turn-settlement'
import * as stop from './planner-stop'
let f: Awaited<ReturnType<typeof plannerFixture>>
let dispatchId: string
beforeEach(async () => {
  f = await plannerFixture()
  dispatchId = (await createPlannerLauncher(f.deps).start(f.mission.id)).attempt.attemptId!
})
afterEach(async () => {
  await f.close()
})
it('claims no-proposal settlement transactionally once and stops without changing the Mission', async () => {
  const stopping = vi.spyOn(stop, 'stopPlanner').mockResolvedValue('stopped')
  const binding = { missionId: f.mission.id, dispatchId }
  const settlement = { outcome: 'success' as const, isError: false, numTurns: 2 }
  await Promise.all([
    settleClaudePlannerTurn(f.runtime, f.store, binding, settlement),
    settleClaudePlannerTurn(f.runtime, f.store, binding, settlement)
  ])
  expect(stopping).toHaveBeenCalledExactlyOnceWith(f.runtime, f.store, binding, 'no_proposal')
  expect(
    f.store
      .listAuditEvents({ missionId: f.mission.id })
      .filter((e) => e.event === 'planner.attempt_failed')
  ).toMatchObject([
    {
      objectId: dispatchId,
      after: { reason: 'no_proposal', evidence: 'turn_settled', ...settlement }
    }
  ])
  expect(f.missions.getMission(f.mission.id).status).toBe('ANALYZING')
})
it.each(['planner.proposed', 'planner.attempt_failed'])(
  'does not stop or overwrite an existing %s receipt',
  async (event) => {
    f.store.appendAuditEvent({
      missionId: f.mission.id,
      objectKind: 'attempt',
      objectId: dispatchId,
      actor: 'MissionController',
      event,
      before: null,
      after: { evidence: 'existing' }
    })
    const stopping = vi.spyOn(stop, 'stopPlanner').mockResolvedValue('stopped')
    await settleClaudePlannerTurn(
      f.runtime,
      f.store,
      { missionId: f.mission.id, dispatchId },
      { outcome: 'failure', isError: true, numTurns: 1 }
    )
    expect(stopping).not.toHaveBeenCalled()
    expect(
      f.store
        .listAuditEvents({ missionId: f.mission.id })
        .filter((e) => e.event === 'planner.attempt_failed')
    ).toHaveLength(event === 'planner.attempt_failed' ? 1 : 0)
  }
)
