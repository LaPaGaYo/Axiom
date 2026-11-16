import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getAxiomControlPlane } from '../control-plane'
import { pendingFixture, type PendingFixture } from './pending-fixture.test-support'
import * as detection from '../../preflight/agent-detection'

let f: PendingFixture
beforeEach(() => {
  f = pendingFixture()
})
afterEach(async () => {
  await f.close()
  vi.restoreAllMocks()
})

it('looks at a waiting Task again in the round a policy update requests', async () => {
  vi.spyOn(detection, 'detectInstalledAgentsWithShellPathHydration').mockResolvedValue([])
  vi.spyOn(f.runtime, 'resolveCodexHomeForWorkerLaunch').mockReturnValue('/pending-fixture-account')
  for (const row of f.store.listTaskStages({ missionId: f.missionId })) {
    if (row.spec.id !== 'T01') {
      f.stage(row.taskId, 'INTEGRATED')
    }
  }
  f.stage('T02', 'RUNNING')
  f.policy({ concurrencyLimit: 1 })
  const taskId = f.task('T01').taskId
  expect(await f.show('T01')).toMatchObject({
    stage: 'READY',
    waitingOn: { on: 'admission', reason: 'concurrency', person: false }
  })
  const schedule = vi.spyOn(getAxiomControlPlane(f.runtime).scheduler, 'scheduleRound')
  const response = await f.call('axiom.policy.update', {
    missionId: f.missionId,
    patch: { concurrencyLimit: 2 }
  })
  expect(schedule).toHaveBeenNthCalledWith(1, f.missionId, 'policy')
  expect(schedule).toHaveBeenCalledTimes(1)
  expect(response).toMatchObject({ ok: true })
  await expect(schedule.mock.results[0]?.value).resolves.toEqual({
    admitted: [],
    skipped: [{ taskId, reason: 'no_eligible_provider' }]
  })
  const audits = f.store.listAuditEvents({ missionId: f.missionId })
  const update = audits.find((event) => event.event === 'policy.updated')
  const refusals = audits.filter((event) => event.event === 'task.admission_refused')
  expect(update).toMatchObject({
    objectId: f.missionId,
    before: { concurrencyLimit: 1 },
    after: { concurrencyLimit: 2 }
  })
  expect(refusals).toHaveLength(1)
  expect(refusals[0]).toMatchObject({
    objectId: taskId,
    actor: 'Scheduler',
    after: {
      installed: [],
      filtered: ['claude', 'codex', 'opencode', 'antigravity'].map((provider) => ({
        provider,
        reason: 'not_installed'
      }))
    }
  })
  expect(refusals[0].sequence).toBeGreaterThan(update!.sequence)
  expect(await f.show('T01')).toMatchObject({
    stage: 'READY',
    waitingOn: { on: 'admission', reason: 'no_eligible_provider', person: true }
  })
  expect(schedule).toHaveBeenCalledTimes(1)
})
