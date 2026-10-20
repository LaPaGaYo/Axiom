import { afterEach, expect, it } from 'vitest'
import { missionSummary } from './control-plane'
import { createInput, fixture } from './mission-controller/controller-fixture.test-support'

const f = fixture()
afterEach(() => f.db.close())

it('uses the latest audit matching the current status, without leaking an older reason', () => {
  const { mission } = f.controller.createMission(createInput)
  const append = (event: string, after: { status: string; reason?: string }) =>
    f.store.appendAuditEvent({
      missionId: mission.id,
      actor: 'test',
      objectKind: 'mission',
      objectId: mission.id,
      event,
      before: null,
      after
    })
  expect(missionSummary(mission, f.store).runId).toBe(mission.runId)
  append('mission.status', { status: mission.status, reason: 'First reason' })
  append('mission.status', { status: 'PAUSED', reason: 'Different status' })
  append('unrelated', { status: mission.status, reason: 'Not a status transition' })
  expect(missionSummary(mission, f.store).reason).toBe('First reason')
  append('mission.status', { status: mission.status, reason: 'Latest reason' })
  expect(missionSummary(mission, f.store).reason).toBe('Latest reason')
  append('mission.status', { status: mission.status })
  expect(missionSummary(mission, f.store).reason).toBeUndefined()
})
