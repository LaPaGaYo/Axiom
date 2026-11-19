import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { finalizationFixture, setStage } from '../finalization/finalization-fixture.test-support'
import { EffectOutbox } from '../outbox/effect-outbox'
import { ArtifactStore } from '../artifacts/artifact-store'
import { ContextBuilder } from '../context-builder/context-builder'
import { AgentFactory } from '../agent-factory/agent-factory'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES } from '../agent-factory/provider-selection'
import { Scheduler } from './scheduler'
import { sweepExecutingMissions } from './mission-sweep'

let f: ReturnType<typeof finalizationFixture>
let effects: EffectOutbox
let scheduler: Scheduler
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'test' })
  scheduler = new Scheduler(
    f.db,
    f.store,
    f.missions,
    new ContextBuilder(f.store, new ArtifactStore(f.store, '/unused')),
    new AgentFactory(f.store, new RulesEngine(PROVIDER_SELECTION_RULES), async () => []),
    { effects }
  )
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})
const round = () => scheduler.scheduleRound(f.missionId, 'stage_change')
const effect = () => f.store.getEffect('mission.finalize', f.missionId)

it('a round moves a Mission to FINALIZING when every Task is settled and one is integrated', async () => {
  setStage(f.store, f.tasks[1].taskId, 'CANCELED')
  f.store.transaction('running_integration', () =>
    effects.enqueue({
      kind: 'integration.apply',
      missionId: f.missionId,
      key: 'last-candidate',
      payload: { taskId: f.tasks[0].taskId, candidateId: 'last-candidate' }
    })
  )
  f.store.leaseDueEffect({
    kind: 'integration.apply',
    missionId: f.missionId,
    now: new Date().toISOString(),
    epoch: 'test'
  })
  const readiness = vi.spyOn(f.missions, 'recomputeReadiness')
  expect(await round()).toEqual({ admitted: [], skipped: [] })
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
  expect(effect()).toMatchObject({
    kind: 'mission.finalize',
    key: f.missionId,
    payload: {},
    status: 'pending'
  })
  expect(readiness).not.toHaveBeenCalled()
  expect(f.store.listAuditEvents({ missionId: f.missionId }).at(-1)).toMatchObject({
    event: 'mission.status',
    before: { status: 'EXECUTING' },
    after: { status: 'FINALIZING' }
  })
  await expect(scheduler.scheduleRound('missing-mission', 'manual')).resolves.toEqual({
    admitted: [],
    skipped: []
  })
})
it('the transition and the mission.finalize effect are written in one transaction', async () => {
  const before = f.store.listAuditEvents({ missionId: f.missionId })
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(effects, 'enqueue').mockImplementationOnce(() => {
    expect(f.db.db.isTransaction).toBe(true)
    expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
    throw new Error('private enqueue failure')
  })
  await expect(round()).resolves.toEqual({ admitted: [], skipped: [] })
  expect(warn.mock.calls).toEqual([
    ['[axiom] Finalization request failed', { missionId: f.missionId }]
  ])
  expect(f.missions.getMission(f.missionId).status).toBe('EXECUTING')
  expect(effect()).toBeUndefined()
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(before)
  await round()
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
  expect(effect()?.status).toBe('pending')
})
it('a Mission stays EXECUTING while a Task is unsettled and when no Task is integrated', async () => {
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  await round()
  expect(f.missions.getMission(f.missionId).status).toBe('EXECUTING')
  for (const task of f.tasks) {
    setStage(f.store, task.taskId, 'CANCELED')
  }
  await round()
  expect(f.missions.getMission(f.missionId).status).toBe('EXECUTING')
  expect(effect()).toBeUndefined()
})
it('a round enqueues the effect of a FINALIZING Mission again only when it is neither pending nor running', async () => {
  f.missions.startFinalization(f.missionId)
  const audits = f.store.listAuditEvents({ missionId: f.missionId })
  await round()
  expect(effect()?.status).toBe('pending')
  for (const status of ['pending', 'running', 'done', 'failed', 'retired']) {
    f.db.db
      .prepare('UPDATE axiom_effects SET status = ?, attempts = 2 WHERE id = ?')
      .run(status, effect()!.id)
    const before = effect()
    await round()
    if (status === 'pending' || status === 'running') {
      expect(effect()).toEqual(before)
    } else {
      expect(effect()).toMatchObject({ id: before!.id, status: 'pending', attempts: 0 })
    }
  }
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(audits)
})
it('the sweep schedules a round of every FINALIZING Mission as well as every EXECUTING one', () => {
  vi.stubEnv('ORCA_E2E_HEADLESS', '0')
  vi.stubEnv('ORCA_E2E_USER_DATA_DIR', '')
  const scheduleRound = vi.fn(async () => ({ admitted: [], skipped: [] }))
  const listMissions = vi.fn((input: { status?: string } = {}) =>
    ['EXECUTING', 'FINALIZING', 'FINALIZING', 'PAUSED'].flatMap((status, index) =>
      status === input.status
        ? [
            {
              ...f.missions.getMission(f.missionId),
              id: `mission-${index}`,
              status: f.missions.getMission(f.missionId).status
            }
          ]
        : []
    )
  )
  sweepExecutingMissions({ listMissions }, { scheduleRound })
  expect(scheduleRound.mock.calls).toEqual([
    ['mission-0', 'sweep'],
    ['mission-1', 'sweep'],
    ['mission-2', 'sweep']
  ])
})
