import { afterEach, expect, it, vi } from 'vitest'
import { planned } from './controller-fixture.test-support'
import { MissionController } from './mission-controller'
import { rpcFixture } from '../rpc-fixture.test-support'
import * as integration from '../execution/integration-base'

const fixtures: ReturnType<typeof rpcFixture>[] = []
afterEach(() => {
  vi.resetAllMocks()
  vi.restoreAllMocks()
  for (const f of fixtures.splice(0)) {
    f.db.close()
  }
})
function harness() {
  const f = rpcFixture()
  fixtures.push(f)
  return { ...f, controller: new MissionController(f.db, f.store) }
}

it('refuses a second Mission on a repository and target branch that another Mission occupies', async () => {
  for (const state of [
    'EXECUTING',
    'PAUSED',
    'BLOCKED',
    'nested',
    'REPLANNING',
    'FINALIZING',
    'READY_FOR_APPROVAL',
    'missing',
    'never-started-nested'
  ] as const) {
    const f = harness()
    const first = planned(f)
    const second = planned({ ...f, controller: new MissionController(f.db, f.store) })
    if (state !== 'never-started-nested') {
      first.controller.startExecution(first.missionId)
    }
    if (['PAUSED', 'nested', 'never-started-nested'].includes(state)) {
      first.controller.pauseMission(first.missionId)
    }
    if (['BLOCKED', 'nested', 'never-started-nested'].includes(state)) {
      first.controller.blockMission(first.missionId, 'waiting')
    }
    if (
      state === 'REPLANNING' ||
      state === 'FINALIZING' ||
      state === 'READY_FOR_APPROVAL' ||
      state === 'missing'
    ) {
      f.store.updateMissionStatus({
        id: first.missionId,
        from: 'EXECUTING',
        to: state === 'missing' ? 'PAUSED' : state,
        previousStatus: null
      })
    }
    const before = f.store.listAuditEvents({ missionId: second.missionId })
    const error = {
      code: 'mission_target_busy',
      data: {
        missionId: second.missionId,
        heldBy: first.missionId,
        repoPath: '/repository',
        targetBranch: 'main',
        reason: expect.stringContaining(first.missionId)
      }
    }
    expect(() => second.controller.startExecution(second.missionId)).toThrowError(
      expect.objectContaining(error)
    )
    expect(f.store.getMission(second.missionId)?.status).toBe('PLANNED')
    expect(f.store.listTaskStages({ missionId: second.missionId, stage: 'READY' })).toEqual([])
    expect(f.store.listAuditEvents({ missionId: second.missionId })).toEqual(before)
    expect(await f.call('axiom.mission.start', { missionId: second.missionId })).toMatchObject({
      ok: false,
      error
    })
    expect(integration.ensureIntegrationBase).not.toHaveBeenCalled()
    expect(f.store.listAuditEvents({ missionId: second.missionId })).toEqual(before)
  }

  for (const overrides of [{ repoPath: '/another-path' }, { repoId: 'another-id' }]) {
    const f = harness()
    const first = planned(f)
    const second = planned(f, undefined, overrides)
    first.controller.startExecution(first.missionId)
    expect(() => second.controller.startExecution(second.missionId)).toThrowError(
      expect.objectContaining({
        code: 'mission_target_busy',
        data: expect.objectContaining({ heldBy: first.missionId })
      })
    )
    // Simulate rows admitted before this rule and use the persisted order, not creation order.
    f.store.updateMissionStatus({
      id: second.missionId,
      from: 'PLANNED',
      to: 'EXECUTING',
      previousStatus: null
    })
    const third = planned(f)
    const heldBy = f.store.listMissions({}).find((mission) => mission.status === 'EXECUTING')?.id
    expect(() => third.controller.startExecution(third.missionId)).toThrowError(
      expect.objectContaining({
        code: 'mission_target_busy',
        data: expect.objectContaining({ heldBy })
      })
    )
  }
})

it('lets a second Mission start on another target branch or once the first has ended', () => {
  for (const state of [
    'another-target',
    'never-started',
    'paused-planned',
    'canceled',
    'another-repository'
  ] as const) {
    const f = harness()
    const first = planned(f)
    const second = planned(
      f,
      undefined,
      state === 'another-target'
        ? { targetBranch: 'other' }
        : state === 'another-repository'
          ? { repoId: 'other', repoPath: '/other' }
          : {}
    )
    if (state === 'paused-planned') {
      first.controller.pauseMission(first.missionId)
    } else if (state !== 'never-started') {
      first.controller.startExecution(first.missionId)
      if (state === 'canceled') {
        first.controller.cancelMission(first.missionId, 'finished')
      }
    }
    expect(second.controller.startExecution(second.missionId).status).toBe('EXECUTING')
    expect(f.store.listTaskStages({ missionId: second.missionId, stage: 'READY' })).toHaveLength(3)
  }
})
