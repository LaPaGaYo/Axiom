import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { EffectOutbox } from '../outbox/effect-outbox'
import { sha256 } from '../artifacts/artifact-store'
import { missionFinalization } from '../read-models/finalization-reads'
import { executeFinalization, registerMissionFinalize } from './mission-finalize'
import { finalizationFixture, setStage } from './finalization-fixture.test-support'
import { mockFinalizationGit } from './finalization-runtime.test-support'
import { reportArtifacts } from './completion-report-fixture.test-support'

let f: ReturnType<typeof finalizationFixture>
let git: ReturnType<typeof mockFinalizationGit>
let artifacts: ReturnType<typeof reportArtifacts>
let effects: EffectOutbox
beforeEach(() => {
  f = finalizationFixture(new OrchestrationDb(':memory:'))
  f.missions.startFinalization(f.missionId)
  git = mockFinalizationGit()
  artifacts = reportArtifacts(f.store)
  effects = new EffectOutbox({ db: f.db, store: f.store, epoch: 'report-test' })
})
afterEach(async () => {
  await effects.stop()
  f.db.close()
  vi.restoreAllMocks()
})
const execute = () => executeFinalization({ ...f, runtime: git.runtime, artifacts }, f.missionId)
const reports = () =>
  artifacts.list({ missionId: f.missionId }).filter((a) => a.kind === 'completion_report')
const record = () => missionFinalization(f.store, f.missionId)
const events = () =>
  f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((e) => e.event === 'mission.finalization')

it('a ready run stores one completion report and the record names its id and hash', async () => {
  await execute()
  expect(reports()).toHaveLength(1)
  const artifact = reports()[0]
  const { content } = await artifacts.read(artifact.id)
  expect(record()).toMatchObject({
    outcome: 'ready',
    reportArtifactId: artifact.id,
    reportSha256: sha256(content)
  })
  expect(artifact).toMatchObject({
    kind: 'completion_report',
    mediaType: 'application/json',
    related: [f.missionId],
    createdBy: 'MissionController'
  })
  expect(f.store.getMission(f.missionId)?.status).toBe('READY_FOR_APPROVAL')
})

it('a stopped run stores no report', async () => {
  setStage(f.store, f.tasks[0].taskId, 'RUNNING')
  await execute()
  expect(reports()).toEqual([])
  expect(record()).toMatchObject({ outcome: 'stopped', reason: 'completion_gate_failed' })
  expect(record()).not.toHaveProperty('reportArtifactId')
  expect(record()).not.toHaveProperty('reportSha256')
})

it('a run repeated after its report was stored reuses that artifact and records ready once', async () => {
  vi.spyOn(f.missions, 'readyForApproval').mockImplementationOnce(() => {
    throw new Error('record refused')
  })
  await expect(execute()).rejects.toThrow('record refused')
  expect(events()).toEqual([])
  const before = reports()
  await execute()
  expect(reports()).toHaveLength(1)
  expect(reports()).toEqual(before)
  expect(events()).toHaveLength(1)
  expect(record()).toMatchObject({ outcome: 'ready', reportArtifactId: reports()[0].id })
  await execute()
  expect(events()).toHaveLength(1)
})

it('a fact that changes while the report is stored fails the run and the next run records the new report', async () => {
  const put = artifacts.put.bind(artifacts)
  vi.spyOn(artifacts, 'put').mockImplementationOnce(async (input) => {
    const artifact = await put(input)
    const task = f.tasks[0]
    f.store.updateTaskSpec({
      taskId: task.taskId,
      expectedStage: task.stage,
      retryPolicy: task.retryPolicy,
      spec: { ...task.spec, title: 'Changed title' }
    })
    return artifact
  })
  await expect(execute()).rejects.toThrow('completion_report_changed')
  expect(events()).toEqual([])
  expect(f.store.getMission(f.missionId)?.status).toBe('FINALIZING')
  await execute()
  expect(reports()).toHaveLength(2)
  expect(events()).toHaveLength(1)
  const current = record()
  expect(current?.outcome).toBe('ready')
  if (current?.outcome !== 'ready' || !current.reportArtifactId) {
    throw new Error('Missing report')
  }
  const { content } = await artifacts.read(current.reportArtifactId)
  expect(content.toString('utf8')).toContain('Changed title')
  expect(sha256(content)).toBe(current.reportSha256)
})

it('a put that fails is tried again and three failures end as finalization_unavailable', async () => {
  const put = vi.spyOn(artifacts, 'put').mockRejectedValue(new Error('store unavailable'))
  registerMissionFinalize({ ...f, runtime: git.runtime, artifacts, effects })
  const enqueue = () =>
    f.store.transaction('report_retry', () =>
      effects.enqueue({
        kind: 'mission.finalize',
        missionId: f.missionId,
        key: f.missionId,
        payload: {}
      })
    )
  enqueue()
  for (let attempt = 1; attempt <= 3; attempt++) {
    f.db.db
      .prepare('UPDATE axiom_effects SET due_at = ? WHERE mission_id = ?')
      .run('2026-01-01T00:00:00Z', f.missionId)
    effects.start()
    await effects.kick()
    await effects.stop()
    expect(put).toHaveBeenCalledTimes(attempt)
    expect(f.store.getEffect('mission.finalize', f.missionId)?.attempts).toBe(attempt)
    if (attempt < 3) {
      expect(record()).toBeUndefined()
    }
  }
  expect(record()).toMatchObject({ outcome: 'stopped', reason: 'finalization_unavailable' })
  expect(reports()).toEqual([])
  expect(f.store.getEffect('mission.finalize', f.missionId)?.status).toBe('failed')
  put.mockRestore()
  enqueue()
  effects.start()
  await effects.kick()
  await effects.stop()
  expect(record()?.outcome).toBe('ready')
  expect(reports()).toHaveLength(1)
})
