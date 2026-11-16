import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { verificationFixture, verificationRuntime } from './verification-fixture.test-support'
import { claimVerification } from './verification-claim'
import { recoverVerifications } from './verification-recovery'

const fixtures: ReturnType<typeof verificationFixture>[] = []
const directories: string[] = []

function batchFixture() {
  const root = mkdtempSync(join(tmpdir(), 'axiom-batch-verification-'))
  directories.push(root)
  const f = verificationFixture(root)
  fixtures.push(f)
  const deps = {
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime: verificationRuntime(),
    runtimeEpoch: 'current-epoch'
  }
  return { ...f, deps }
}

afterEach(() => {
  vi.restoreAllMocks()
  for (const f of fixtures) {
    f.db.close()
  }
  fixtures.length = 0
  for (const directory of directories) {
    rmSync(directory, { recursive: true, force: true })
  }
  directories.length = 0
})

it('leaves a queued run of a batch alone and claims the candidate run behind it', () => {
  for (const missionScoped of [false, true]) {
    const f = batchFixture()
    const batch = f.store.insertVerificationRun({
      ...f.run,
      id: 'batch-run-first',
      batchId: 'batch',
      verdictDetail: { phase: 'waiting-for-integration' },
      verifier: 'IntegrationController'
    })
    f.db.db
      .prepare('UPDATE verification_runs SET created_at = ? WHERE id = ?')
      .run('2000-01-01 00:00:00', batch.id)
    const before = f.store.getVerificationRun(batch.id)
    const missionId = missionScoped ? f.missionId : undefined
    const claimed = claimVerification(f.deps, missionId)
    expect(f.store.getVerificationRun(batch.id)?.status).toBe('QUEUED')
    expect(f.store.getVerificationRun(batch.id)).toEqual(before)
    expect(f.store.getVerificationRun(batch.id)).toMatchObject({
      claimCount: 0,
      verdictDetail: batch.verdictDetail
    })
    expect(
      f.store.listAuditEvents({ missionId: f.missionId }).filter((e) => e.objectId === batch.id)
    ).toEqual([])
    expect(claimed).toMatchObject({ id: 'vrun-1', status: 'RUNNING' })
    expect(f.store.getVerificationRun(f.run.id)?.status).toBe('RUNNING')
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')

    const runs = f.store.listVerificationRuns({ missionId: f.missionId })
    const task = f.store.getTaskStage(f.task.taskId)
    const audit = f.store.listAuditEvents({ missionId: f.missionId })
    expect(claimVerification(f.deps, missionId)).toBeUndefined()
    expect(f.store.listVerificationRuns({ missionId: f.missionId })).toEqual(runs)
    expect(f.store.getTaskStage(f.task.taskId)).toEqual(task)
    expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(audit)
  }
})

it('leaves a running or uncleaned run of a batch alone when it recovers', async () => {
  const f = batchFixture()
  const running = f.store.insertVerificationRun({
    ...f.run,
    id: 'running-batch',
    batchId: 'batch-running',
    status: 'RUNNING',
    verifier: 'IntegrationController'
  })
  f.store.updateVerificationRun({
    id: running.id,
    expectedStatus: 'RUNNING',
    runtimeEpoch: 'old-epoch',
    worktreeId: 'integration-running-worktree'
  })
  const failed = f.store.insertVerificationRun({
    ...f.run,
    id: 'failed-batch',
    batchId: 'batch-failed',
    status: 'FAIL',
    verdictDetail: { cleanupPending: true },
    verifier: 'IntegrationController'
  })
  f.store.updateVerificationRun({
    id: failed.id,
    expectedStatus: 'FAIL',
    runtimeEpoch: 'old-epoch',
    worktreeId: 'integration-failed-worktree'
  })
  const beforeRunning = f.store.getVerificationRun(running.id)
  const beforeFailed = f.store.getVerificationRun(failed.id)
  f.store.claimVerificationRun({ id: f.run.id, runtimeEpoch: 'old-epoch', startedAt: 'before' })

  const report = await recoverVerifications(f.deps)
  expect(f.store.getVerificationRun(running.id)?.status).toBe('RUNNING')
  expect(f.store.getVerificationRun(running.id)).toEqual(beforeRunning)
  expect(f.store.getVerificationRun(failed.id)).toEqual(beforeFailed)
  const removed = f.deps.runtime.removeManagedWorktree.mock.calls.map(([selector]) => selector)
  expect(removed).not.toContain('id:integration-running-worktree')
  expect(removed).not.toContain('id:integration-failed-worktree')
  expect(
    f.store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => [running.id, failed.id].includes(e.objectId))
  ).toEqual([])
  expect(report).toEqual({ requeued: 1, cleaned: 0, failed: 0 })
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'QUEUED',
    runtimeEpoch: null
  })
})
