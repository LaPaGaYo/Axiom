import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fixture } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import { VerificationService } from './verification-service'
import { verificationFixture, verificationRuntime } from './verification-fixture.test-support'
import * as pin from './verification-worktree'

beforeEach(() => {
  vi.stubEnv('ORCA_E2E_HEADLESS', '1')
  vi.stubEnv('AXIOM_E2E_HOLD_VERIFICATION', '1')
})
afterEach(() => vi.unstubAllEnvs())

it('reopens a file DB, recycles a prepared worktree, preserves evidence and reclaims exactly once', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-verification-restart-'))
  const dbPath = path.join(root, 'orchestration.db')
  const f = verificationFixture(root, dbPath)
  const runtime = verificationRuntime()
  vi.spyOn(pin, 'pinVerificationCandidate').mockResolvedValue(undefined)
  const first = new VerificationService({
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime,
    runtimeEpoch: 'epoch-before'
  })
  let reopened: ReturnType<typeof fixture> | undefined
  try {
    await first.kick()
    const old = f.store.getVerificationRun(f.run.id)!
    const oldArtifacts = f.store.listArtifacts({ missionId: f.missionId })
    f.db.close()
    reopened = fixture(dbPath)
    const store = reopened.store
    const service = new VerificationService({
      store,
      missions: reopened.controller,
      artifacts: new ArtifactStore(store, root),
      runtime,
      runtimeEpoch: 'epoch-after'
    })
    await service.recoverAtBoot()
    expect(runtime.removeManagedWorktree).toHaveBeenCalledExactlyOnceWith(`id:${old.worktreeId}`, {
      force: true
    })
    expect(store.getVerificationRun(old.id)).toMatchObject({
      status: 'QUEUED',
      worktreeId: null,
      runtimeEpoch: null,
      claimCount: 1,
      verdictDetail: { phase: 'requeued', reason: 'restart', previousClaim: 1 }
    })
    const audit = store.listAuditEvents({ missionId: f.missionId })
    await service.recoverAtBoot()
    expect(store.listAuditEvents({ missionId: f.missionId })).toEqual(audit)
    expect(store.listArtifacts({ missionId: f.missionId })).toEqual(oldArtifacts)
    await service.kick()
    const current = store.getVerificationRun(old.id)!
    expect(current).toMatchObject({
      status: 'RUNNING',
      claimCount: 2,
      runtimeEpoch: 'epoch-after',
      verdictDetail: { phase: 'prepared' }
    })
    expect(current.worktreeId).not.toBe(old.worktreeId)
    expect(store.getTaskStage(old.taskId)?.stage).toBe('VERIFYING')
    expect(store.listArtifacts({ missionId: f.missionId })).toHaveLength(2)
    const sequence = store
      .listAuditEvents({ missionId: f.missionId })
      .filter((e) => e.objectId === old.id)
      .map((e) => e.event)
    expect(sequence).toEqual([
      'verification.claimed',
      'verification.prepared',
      'verification.requeued',
      'verification.claimed',
      'verification.prepared'
    ])
    console.log(
      '[M3-01 restart]',
      JSON.stringify({
        runId: old.id,
        sequence,
        claims: [old.claimCount, current.claimCount],
        artifacts: 2
      })
    )
  } finally {
    reopened?.db.close()
    if (!reopened) {
      f.db.close()
    }
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})

it('removes only orphan verification worktrees through runtime listing and tolerates a recorded worktree already gone', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-verification-orphans-'))
  const f = verificationFixture(root)
  const runtime = verificationRuntime()
  vi.spyOn(pin, 'pinVerificationCandidate').mockResolvedValue(undefined)
  try {
    const service = new VerificationService({
      store: f.store,
      missions: f.controller,
      artifacts: f.artifacts,
      runtime,
      runtimeEpoch: 'epoch-one'
    })
    await service.kick()
    const active = runtime.worktrees[0]
    runtime.worktrees.push(
      { ...active, id: 'repo::/orphan', branch: 'axiom/verify/missing/legacy' },
      { ...active, id: 'repo::/attempt', branch: f.binding.branch }
    )
    await service.recoverAtBoot()
    expect(runtime.removeManagedWorktree).toHaveBeenCalledExactlyOnceWith('id:repo::/orphan')
    runtime.removeManagedWorktree.mockClear()
    runtime.worktrees.splice(0, 1)
    runtime.removeManagedWorktree.mockRejectedValueOnce(new Error('selector_not_found'))
    const reboot = new VerificationService({
      store: f.store,
      missions: f.controller,
      artifacts: f.artifacts,
      runtime,
      runtimeEpoch: 'epoch-two'
    })
    await reboot.recoverAtBoot()
    expect(f.store.getVerificationRun(f.run.id)?.status).toBe('QUEUED')
    expect(runtime.worktrees.map((w) => w.id)).toEqual(['repo::/attempt'])
  } finally {
    f.db.close()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})

it('retains failed cleanup ownership until boot can remove the detached worktree', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'axiom-verification-cleanup-'))
  const f = verificationFixture(root)
  const runtime = verificationRuntime()
  vi.spyOn(pin, 'pinVerificationCandidate').mockRejectedValue(
    new pin.VerificationPreparationError('candidate_mismatch', 'Candidate tree mismatch.')
  )
  runtime.removeManagedWorktree.mockRejectedValueOnce(new Error('runtime_unavailable'))
  try {
    const deps = { store: f.store, missions: f.controller, artifacts: f.artifacts, runtime }
    const first = new VerificationService({ ...deps, runtimeEpoch: 'epoch-before' })
    await first.kick()
    const failed = f.store.getVerificationRun(f.run.id)!
    expect(failed).toMatchObject({
      status: 'INCONCLUSIVE',
      worktreeId: expect.any(String),
      verdictDetail: { phase: 'prepare_failed', cleanupPending: true }
    })
    const audit = f.store.listAuditEvents({ missionId: f.missionId })
    // Git may have detached HEAD before failure; branch scans cannot recover ownership here.
    runtime.worktrees[0].branch = ''
    const next = new VerificationService({ ...deps, runtimeEpoch: 'epoch-after' })
    await next.recoverAtBoot()
    expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
      status: 'INCONCLUSIVE',
      worktreeId: null,
      verdictDetail: { phase: 'prepare_failed', cleanupPending: false }
    })
    expect(runtime.worktrees).toEqual([])
    await next.recoverAtBoot()
    expect(runtime.removeManagedWorktree).toHaveBeenCalledTimes(2)
    expect(f.store.listAuditEvents({ missionId: f.missionId })).toEqual(audit)
  } finally {
    f.db.close()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})
