import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { EffectOutbox } from '../outbox/effect-outbox'
import { missionFinalization } from '../read-models/finalization-reads'
import { executeFinalization, registerMissionFinalize } from './mission-finalize'
import {
  finalizationFixture,
  integrationHead,
  targetHead,
  recordHead,
  setStage
} from './finalization-fixture.test-support'
import { mockFinalizationGit } from './finalization-runtime.test-support'

let f: ReturnType<typeof finalizationFixture>
let git: ReturnType<typeof mockFinalizationGit>
let effects: EffectOutbox
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  f.missions.startFinalization(f.missionId)
  git = mockFinalizationGit()
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'finalization' })
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  vi.restoreAllMocks()
})
const execute = () => executeFinalization({ ...f, runtime: git.runtime }, f.missionId)
const record = () => missionFinalization(f.store, f.missionId)
const events = () =>
  f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((e) => e.event === 'mission.finalization')
const codeOne = () => Object.assign(new Error('absent or not ancestor'), { code: 1 })

it('records ready and moves to READY_FOR_APPROVAL when the target is contained and the gate passes', async () => {
  const ready = vi.spyOn(f.missions, 'readyForApproval').mockImplementationOnce(() => {
    throw new Error('transaction refused')
  })
  await expect(execute()).rejects.toThrow('transaction refused')
  expect(events()).toEqual([])
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
  ready.mockRestore()
  expect(await execute()).toBe('done')
  expect(f.missions.getMission(f.missionId).status).toBe('READY_FOR_APPROVAL')
  expect(record()).toMatchObject({
    outcome: 'ready',
    targetBranch: 'main',
    integrationHead,
    targetHead
  })
  expect(record()!.gate).toHaveLength(8)
  expect(record()!.gate!.every((item) => item.pass)).toBe(true)
  expect(events()[0].after).not.toHaveProperty('at')
  expect(git.readGit.mock.calls.slice(-2)).toEqual([
    ['/repository', ['rev-parse', '--verify', '--quiet', 'refs/heads/main^{commit}'], true],
    ['/repository', ['merge-base', '--is-ancestor', targetHead, integrationHead], true]
  ])
})
it('stops with target_branch_moved and stays FINALIZING when the target is not an ancestor', async () => {
  git.readGit.mockResolvedValueOnce(targetHead).mockRejectedValueOnce(codeOne())
  await execute()
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
  expect(record()).toMatchObject({
    outcome: 'stopped',
    reason: 'target_branch_moved',
    integrationHead,
    targetHead
  })
  expect(record()).not.toHaveProperty('gate')
  git.readGit.mockRejectedValueOnce(codeOne())
  await execute()
  expect(record()).toMatchObject({ reason: 'target_branch_not_found' })
  expect(record()).not.toHaveProperty('targetHead')
})
it('stops with integration_head_unexpected when the branch is not at the recorded head', async () => {
  git.readHead.mockResolvedValueOnce(targetHead)
  await execute()
  expect(record()).toMatchObject({
    reason: 'integration_head_unexpected',
    integrationHead: targetHead
  })
  expect(git.readGit).not.toHaveBeenCalled()
  recordHead(f.store, f.missionId, 'fixture-head')
  await execute()
  expect(record()).toMatchObject({ reason: 'integration_head_unexpected', integrationHead })
  recordHead(f.store, f.missionId)
  git.readGit.mockImplementationOnce(async () => {
    recordHead(f.store, f.missionId, targetHead)
    return targetHead
  })
  await execute()
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
  expect(record()!.gate!.find((item) => item.id === 'integration_head_recorded')?.pass).toBe(false)
})
it('stops with completion_gate_failed and records the failing items', async () => {
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  f.db.createGate({ taskId: f.tasks[0].taskId, question: 'Confirm scope' })
  await execute()
  expect(record()).toMatchObject({ outcome: 'stopped', reason: 'completion_gate_failed' })
  expect(
    record()!
      .gate!.filter((item) => !item.pass)
      .map((item) => item.id)
  ).toEqual(['tasks_settled', 'no_open_questions'])
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
})
it('writes no second record when the outcome did not change', async () => {
  git.readGit.mockImplementation(async (_cwd, args) => {
    if (args[0] === 'rev-parse') {
      return targetHead
    }
    throw codeOne()
  })
  await execute()
  const before = events()
  const since = record()!.at
  await execute()
  expect(events()).toEqual(before)
  expect(record()!.at).toBe(since)
  f.missions.pauseMission(f.missionId)
  f.missions.resumeMission(f.missionId)
  expect(record()).toBeUndefined()
  await execute()
  expect(events()).toHaveLength(2)
})
it('does nothing when the Mission is no longer FINALIZING', async () => {
  f.missions.pauseMission(f.missionId)
  const before = f.store.listAuditEvents({ missionId: f.missionId })
  expect(await execute()).toBe('done')
  expect(git.readHead).not.toHaveBeenCalled()
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(before)
  f.missions.resumeMission(f.missionId)
  git.readHead.mockImplementationOnce(async () => {
    f.missions.pauseMission(f.missionId)
    f.missions.resumeMission(f.missionId)
    return integrationHead
  })
  await execute()
  expect(record()).toBeUndefined()
  expect(f.missions.getMission(f.missionId).status).toBe('FINALIZING')
})
it('records finalization_unavailable after the last failed try and a later run replaces it', async () => {
  registerMissionFinalize({ ...f, runtime: git.runtime, effects })
  f.store.transaction('enqueue_finalization', () =>
    effects.enqueue({
      kind: 'mission.finalize',
      missionId: f.missionId,
      key: f.missionId,
      payload: {}
    })
  )
  git.readHead.mockRejectedValueOnce(new Error('integration_head_unavailable'))
  git.readGit.mockRejectedValueOnce(Object.assign(new Error('read failed'), { code: 128 }))
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (attempt === 3) {
      git.readGit
        .mockResolvedValueOnce(targetHead)
        .mockRejectedValueOnce(Object.assign(new Error('ancestry failed'), { code: 128 }))
    }
    f.db.db
      .prepare('UPDATE axiom_effects SET due_at = ? WHERE mission_id = ?')
      .run('2026-01-01T00:00:00Z', f.missionId)
    effects.start()
    await effects.kick()
    await effects.stop()
    expect(f.store.getEffect('mission.finalize', f.missionId)?.attempts).toBe(attempt)
    if (attempt < 3) {
      expect(record()).toBeUndefined()
    }
  }
  expect(f.store.getEffect('mission.finalize', f.missionId)?.status).toBe('failed')
  expect(record()).toMatchObject({ outcome: 'stopped', reason: 'finalization_unavailable' })
  f.store.transaction('retry_finalization', () =>
    effects.enqueue({
      kind: 'mission.finalize',
      missionId: f.missionId,
      key: f.missionId,
      payload: {}
    })
  )
  effects.start()
  await effects.kick()
  await effects.stop()
  expect(record()?.outcome).toBe('ready')
  expect(events()).toHaveLength(2)
  expect(f.store.getEffect('mission.finalize', f.missionId)?.status).toBe('done')
})
