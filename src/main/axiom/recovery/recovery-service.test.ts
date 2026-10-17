import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { replaceRunBinding } from '../mailbox-runtime.test-support'
import { RecoveryService } from './recovery-service'

describe('M1 RecoveryService', () => {
  let f: ReturnType<typeof planned>
  let recovery: RecoveryService
  beforeEach(() => {
    f = planned(fixture())
    recovery = new RecoveryService(f.db, f.store, f.controller)
  })
  afterEach(() => {
    vi.restoreAllMocks()
    f.db.close()
  })

  it('derives readiness from durable stages and explicitly has no M1 Attempts', () => {
    const reconcile = vi.spyOn(recovery, 'reconcileAttempts')
    // Durable EXECUTING state with readiness not yet computed (interrupted startup).
    f.store.updateMissionStatus({
      id: f.missionId,
      from: 'PLANNED',
      to: 'EXECUTING',
      previousStatus: null
    })
    const report = recovery.recover()
    const ready = f.controller
      .listTasks({ missionId: f.missionId, stage: 'READY' })
      .map((t) => t.taskId)
    expect(ready).toHaveLength(3)
    expect(report).toEqual({
      missions: [{ id: f.missionId, status: 'EXECUTING', moved: ready }],
      blocked: []
    })
    expect(reconcile).toHaveReturnedWith('no_attempts_in_m1')
    expect(recovery.recover().missions[0]?.moved).toEqual([])
  })

  it.each(['missing', 'unbound'] as const)('blocks a %s Run without recreating it', (kind) => {
    const mission = f.controller.getMission(f.missionId)
    if (kind === 'missing') {
      vi.spyOn(f.db, 'getRun').mockReturnValue(undefined)
    } else {
      replaceRunBinding(f.db, mission.coordinatorOrcaSessionId)
    }
    const create = vi.spyOn(f.db, 'createRun')
    expect(recovery.recover()).toEqual({
      missions: [{ id: mission.id, status: 'BLOCKED', moved: [] }],
      blocked: [{ id: mission.id, reason: 'run_binding_lost' }]
    })
    const events = f.store.listAuditEvents({ missionId: mission.id })
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ event: 'recovery.run_binding_lost' })])
    )
    recovery.recover()
    expect(f.store.listAuditEvents({ missionId: mission.id })).toEqual(events)
    expect(create).not.toHaveBeenCalled()
  })

  it('ignores terminal Missions and preserves paused/blocked states', () => {
    f.controller.pauseMission(f.missionId)
    expect(recovery.recover().missions).toEqual([{ id: f.missionId, status: 'PAUSED', moved: [] }])
    f.controller.blockMission(f.missionId, 'manual block')
    expect(recovery.recover().missions).toEqual([{ id: f.missionId, status: 'BLOCKED', moved: [] }])
    f.controller.cancelMission(f.missionId, 'cancel')
    expect(recovery.recover()).toEqual({ missions: [], blocked: [] })
  })
})
