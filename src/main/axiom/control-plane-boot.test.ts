import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../runtime/orchestration/db'
import { provenance } from '../../shared/axiom-contract/contract-fixtures.test-support'
import { createInput, propose } from './mission-controller/controller-fixture.test-support'
import { insertMail, mailboxRuntime, replaceRunBinding } from './mailbox-runtime.test-support'
import { RunMailboxConsumer } from './mission-controller/run-mailbox-consumer'
import { MissionController } from './mission-controller/mission-controller'
import * as launcher from './execution/attempt-launcher'
import { getAxiomControlPlane } from './control-plane'
import { startAxiomControlPlane, stopAxiomControlPlane } from './control-plane-boot'

describe('M1 Control Plane boot', () => {
  let directory: string
  let db: OrchestrationDb
  let runtime: ReturnType<typeof mailboxRuntime>
  beforeEach(() => {
    vi.useFakeTimers()
    directory = mkdtempSync(join(tmpdir(), 'axiom-m1-restart-'))
    db = new OrchestrationDb(join(directory, 'orchestration.db'))
    runtime = mailboxRuntime(db)
  })
  afterEach(() => {
    stopAxiomControlPlane(runtime)
    db.close()
    rmSync(directory, { recursive: true, force: true })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('awaits verification recovery before the first kick and includes verification in the existing timer', async () => {
    const cp = getAxiomControlPlane(runtime)
    const order: string[] = []
    vi.spyOn(cp.recovery, 'recover').mockImplementation(() => {
      order.push('missions')
      return { missions: [], blocked: [] }
    })
    let release!: () => void
    vi.spyOn(cp.verification, 'recoverAtBoot').mockImplementation(async () => {
      order.push('verification-recovery')
      await new Promise<void>((resolve) => {
        release = resolve
      })
    })
    const kick = vi.spyOn(cp.verification, 'kick').mockImplementation(async () => {
      order.push('kick')
    })
    const boot = startAxiomControlPlane(runtime)
    expect(order).toEqual(['missions', 'verification-recovery'])
    expect(kick).not.toHaveBeenCalled()
    release()
    await boot
    expect(order).toEqual(['missions', 'verification-recovery', 'kick'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kick).toHaveBeenCalledTimes(2)
    stopAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kick).toHaveBeenCalledTimes(2)
  })

  it('does not install an obsolete boot timer after a stop and restart during recovery', async () => {
    const cp = getAxiomControlPlane(runtime)
    vi.spyOn(cp.recovery, 'recover').mockReturnValue({ missions: [], blocked: [] })
    let release!: () => void
    const recovery = new Promise<void>((resolve) => {
      release = resolve
    })
    vi.spyOn(cp.verification, 'recoverAtBoot').mockReturnValue(recovery)
    const kick = vi.spyOn(cp.verification, 'kick').mockResolvedValue(undefined)
    const first = startAxiomControlPlane(runtime)
    stopAxiomControlPlane(runtime)
    const second = startAxiomControlPlane(runtime)
    release()
    await Promise.all([first, second])
    expect(kick).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kick).toHaveBeenCalledTimes(2)
    stopAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(kick).toHaveBeenCalledTimes(2)
  })

  it('requests one resume round for persisted EXECUTING Missions with READY Tasks and no bindings', async () => {
    vi.spyOn(launcher, 'createAttemptLauncher').mockReturnValue(vi.fn(async () => {}))
    const cp = getAxiomControlPlane(runtime)
    // Persist the interrupted state without the running plane's scheduling hooks.
    const missions = new MissionController(db, cp.store)
    const { mission, goalRevision } = missions.createMission(createInput)
    const plan = propose(missions, mission.id, goalRevision.id)
    missions.approvePlan({ planRevisionId: plan.id, resolver: 'tester', provenance })
    missions.startExecution(mission.id)
    expect(missions.listTasks({ missionId: mission.id, stage: 'READY' })).toHaveLength(3)
    expect(cp.store.listAttemptBindings({ missionId: mission.id })).toEqual([])
    const schedule = vi
      .spyOn(cp.scheduler, 'scheduleRound')
      .mockResolvedValue({ admitted: [], skipped: [] })

    expect(await startAxiomControlPlane(runtime)).toEqual({
      missions: [{ id: mission.id, status: 'EXECUTING', moved: [] }],
      blocked: []
    })
    await startAxiomControlPlane(runtime)
    expect(schedule).toHaveBeenCalledExactlyOnceWith(mission.id, 'resume')
  })

  it.each(['PAUSED', 'BLOCKED', 'CANCELED', 'COMPLETED', 'ANALYZING', 'PLANNED'] as const)(
    'does not request a boot round for a %s Mission',
    async (status) => {
      const cp = getAxiomControlPlane(runtime)
      const { mission } = cp.missions.createMission(createInput)
      cp.store.updateMissionStatus({
        id: mission.id,
        from: mission.status,
        to: status,
        previousStatus: null
      })
      const schedule = vi.spyOn(cp.scheduler, 'scheduleRound')
      await startAxiomControlPlane(runtime)
      expect(schedule).not.toHaveBeenCalled()
    }
  )

  it('does not schedule an EXECUTING Mission whose Run binding was lost', async () => {
    const cp = getAxiomControlPlane(runtime)
    const { mission } = cp.missions.createMission(createInput)
    cp.store.updateMissionStatus({
      id: mission.id,
      from: mission.status,
      to: 'EXECUTING',
      previousStatus: null
    })
    replaceRunBinding(db, mission.coordinatorOrcaSessionId)
    const schedule = vi.spyOn(cp.scheduler, 'scheduleRound')
    expect((await startAxiomControlPlane(runtime))?.blocked).toEqual([
      { id: mission.id, reason: 'run_binding_lost' }
    ])
    expect(schedule).not.toHaveBeenCalled()
  })

  it('keeps an empty resume round audit-silent', async () => {
    const cp = getAxiomControlPlane(runtime)
    const { mission } = cp.missions.createMission(createInput)
    cp.store.updateMissionStatus({
      id: mission.id,
      from: mission.status,
      to: 'EXECUTING',
      previousStatus: null
    })
    const before = cp.store.listAuditEvents({ missionId: mission.id })
    const schedule = vi.spyOn(cp.scheduler, 'scheduleRound')
    await startAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(0)
    expect(schedule).toHaveBeenCalledExactlyOnceWith(mission.id, 'resume')
    expect(cp.store.listAuditEvents({ missionId: mission.id })).toEqual(before)
  })

  it('reopens all Mission objects and stages, resumes the persisted generation, drains and acknowledges once', async () => {
    await startAxiomControlPlane(runtime)
    const cp = getAxiomControlPlane(runtime)
    const { mission, goalRevision } = cp.missions.createMission(createInput)
    const plan = propose(cp.missions, mission.id, goalRevision.id)
    cp.missions.approvePlan({ planRevisionId: plan.id, resolver: 'tester', provenance })
    cp.missions.startExecution(mission.id)
    await vi.advanceTimersByTimeAsync(0)
    const before = cp.missions.getMission(mission.id)
    const tasks = cp.missions.listTasks({ missionId: mission.id })
    const run = db.getRun(mission.runId)
    expect(tasks.filter((t) => t.stage === 'READY')).toHaveLength(3)
    expect(cp.missions.recomputeReadiness(mission.id)).toEqual([])
    stopAxiomControlPlane(runtime)
    const messages = [insertMail(db, mission.runId), insertMail(db, mission.runId)]
    db.close()
    db = new OrchestrationDb(join(directory, 'orchestration.db'))
    runtime = mailboxRuntime(db)
    const reboot = getAxiomControlPlane(runtime)
    expect(reboot).not.toBe(cp)
    expect(await startAxiomControlPlane(runtime)).toEqual({
      missions: [{ id: mission.id, status: 'EXECUTING', moved: [] }],
      blocked: []
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(reboot.missions.getMission(mission.id)).toEqual(before)
    expect(
      reboot.missions.getGoal({ missionId: mission.id, goalRevisionId: goalRevision.id })
    ).toEqual(goalRevision)
    expect(reboot.missions.getPlan(plan.id)).toMatchObject({ ...plan, status: 'APPROVED' })
    expect(reboot.missions.listTasks({ missionId: mission.id })).toEqual(tasks)
    expect(reboot.missions.recomputeReadiness(mission.id)).toEqual([])
    expect(db.getRun(mission.runId)).toEqual(run)
    expect(
      reboot.store
        .listAuditEvents({ missionId: mission.id })
        .filter((e) => e.event === 'mailbox.message')
        .map((e) => e.objectId)
    ).toEqual(messages.map((m) => m.id))
    expect(db.getUnreadRunMailbox(mission.runId)).toEqual([])
    expect(db.hasOutstandingRunDelivery(mission.runId)).toBe(false)
    expect(db.getRunMailboxHistory(mission.runId).every((m) => m.read === 1)).toBe(true)
  })

  it('replays a batch across file reopen without duplicating already-committed audit effects', async () => {
    const cp = getAxiomControlPlane(runtime)
    const { mission } = cp.missions.createMission(createInput)
    const run = db.getRun(mission.runId)!
    const message = insertMail(db, run.id)
    const consumer = new RunMailboxConsumer(runtime, cp.store, cp.missions, {
      missionId: mission.id,
      runId: run.id,
      consumerGeneration: run.consumer_generation
    })
    const handle = consumer.handle.bind(consumer)
    vi.spyOn(consumer, 'handle').mockImplementationOnce((messages) => {
      handle(messages)
      throw new Error('crash before ack')
    })
    expect(() => consumer.drain()).toThrow('crash before ack')
    expect(db.hasOutstandingRunDelivery(run.id)).toBe(true)
    consumer.stop()
    db.close()
    db = new OrchestrationDb(join(directory, 'orchestration.db'))
    runtime = mailboxRuntime(db)
    const deliveries = vi.spyOn(db, 'getOrCreateRunDelivery')
    await startAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(0)
    expect(deliveries.mock.results[0]?.value).toMatchObject({ replayed: true, messages: [message] })
    expect(
      getAxiomControlPlane(runtime)
        .store.listAuditEvents({ missionId: mission.id })
        .filter((event) => event.event === 'mailbox.message')
    ).toMatchObject([{ objectId: message.id }])
    expect(db.hasOutstandingRunDelivery(run.id)).toBe(false)
  })

  it('boots idempotently and starts/stops consumers with create, resume, unblock, pause and cancel', async () => {
    const cp = getAxiomControlPlane(runtime)
    const recover = vi.spyOn(cp.recovery, 'recover')
    await startAxiomControlPlane(runtime)
    await startAxiomControlPlane(runtime)
    expect(recover).toHaveBeenCalledTimes(1)
    const { mission } = cp.missions.createMission(createInput)
    await vi.advanceTimersByTimeAsync(0)
    const address = `run:${mission.runId}`
    const deliver = async () => {
      const message = insertMail(db, mission.runId)
      runtime.notifyMessageArrived(address, 'status')
      await vi.advanceTimersByTimeAsync(0)
      expect(db.getRunMailboxHistory(mission.runId)).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: message.id, read: 1 })])
      )
    }
    await deliver()
    cp.missions.pauseMission(mission.id)
    insertMail(db, mission.runId)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(db.getUnreadRunMailbox(mission.runId)).toHaveLength(1)
    stopAxiomControlPlane(runtime)
    await startAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    cp.missions.resumeMission(mission.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(db.getUnreadRunMailbox(mission.runId)).toEqual([])
    cp.missions.blockMission(mission.id, 'manual')
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    cp.missions.unblockMission(mission.id)
    await deliver()
    cp.missions.cancelMission(mission.id, 'done testing')
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    insertMail(db, mission.runId)
    stopAxiomControlPlane(runtime)
    await startAxiomControlPlane(runtime)
    await vi.advanceTimersByTimeAsync(0)
    expect(db.getUnreadRunMailbox(mission.runId)).toHaveLength(1)
  })

  it('does not consume a Mission whose Run binding was lost while paused', async () => {
    await startAxiomControlPlane(runtime)
    const cp = getAxiomControlPlane(runtime)
    const { mission } = cp.missions.createMission(createInput)
    cp.missions.pauseMission(mission.id)
    replaceRunBinding(db, mission.coordinatorOrcaSessionId)
    insertMail(db, mission.runId)
    cp.missions.resumeMission(mission.id)
    await vi.advanceTimersByTimeAsync(0)
    expect(cp.missions.getMission(mission.id).status).toBe('BLOCKED')
    expect(db.getUnreadRunMailbox(mission.runId)).toHaveLength(1)
    expect(vi.getTimerCount()).toBe(1)
  })
})
