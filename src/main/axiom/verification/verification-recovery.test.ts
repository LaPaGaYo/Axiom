import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  queueAnotherVerification,
  verificationFixture,
  verificationRuntime
} from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { recoverVerifications } from './verification-recovery'
import * as pin from './verification-worktree'

let root: string
let f: ReturnType<typeof verificationFixture>
let runtime: ReturnType<typeof verificationRuntime>
beforeEach(async () => {
  vi.stubEnv('ORCA_E2E_HEADLESS', '1')
  vi.stubEnv('AXIOM_E2E_HOLD_VERIFICATION', '1')
  root = await mkdtemp(path.join(tmpdir(), 'axiom-verification-recovery-'))
  f = verificationFixture(root)
  runtime = verificationRuntime()
  vi.spyOn(pin, 'pinVerificationCandidate').mockResolvedValue(undefined)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

const dependencies = (runtimeEpoch: string) => ({
  store: f.store,
  missions: f.controller,
  artifacts: f.artifacts,
  runtime,
  runtimeEpoch
})
const events = (runId: string) =>
  f.store.listAuditEvents({ missionId: f.missionId }).filter((e) => e.objectId === runId)

it('isolates stale removal failure, audits once per boot and heals on a later kick', async () => {
  const second = queueAnotherVerification(f)
  await new VerificationService(dependencies('epoch-before')).kick()
  const old = f.store.getVerificationRun(f.run.id)!
  const remove = runtime.removeManagedWorktree.getMockImplementation()!
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    if (selector === `id:${old.worktreeId}`) {
      throw new Error('sensitive-runtime-output')
    }
    return remove(selector)
  })
  const service = new VerificationService(dependencies('epoch-after'))
  await service.recoverAtBoot()
  const pending = f.store.getVerificationRun(old.id)!
  expect(console.warn).toHaveBeenCalledWith('[axiom] Verification recovery incomplete', {
    requeued: 1,
    cleaned: 0,
    failed: 1
  })
  expect(pending).toMatchObject({
    status: 'RUNNING',
    runtimeEpoch: 'epoch-before',
    worktreeId: old.worktreeId,
    claimCount: 1,
    verdictDetail: { ...old.verdictDetail, cleanupPending: true }
  })
  expect(f.store.getVerificationRun(second.id)).toMatchObject({
    status: 'QUEUED',
    runtimeEpoch: null,
    worktreeId: null,
    verdictDetail: { phase: 'requeued' }
  })
  expect(events(old.id).at(-1)).toMatchObject({
    actor: 'VerificationService',
    objectKind: 'verification_run',
    event: 'verification.recovery_failed',
    after: { worktreeId: old.worktreeId, reason: 'worktree_removal_failed' }
  })
  const failedAudit = events(old.id)
  await service.kick()
  await service.kick()
  expect(f.store.getVerificationRun(old.id)).toEqual(pending)
  expect(events(old.id)).toEqual(failedAudit)
  expect(f.store.getVerificationRun(second.id)).toMatchObject({
    status: 'RUNNING',
    runtimeEpoch: 'epoch-after',
    claimCount: 2,
    verdictDetail: { phase: 'prepared' }
  })
  expect(runtime.listManagedWorktrees).toHaveBeenCalledTimes(1)
  expect(
    JSON.stringify([events(old.id), pending, vi.mocked(console.warn).mock.calls])
  ).not.toContain('sensitive-runtime-output')

  runtime.removeManagedWorktree.mockImplementation(remove)
  await service.kick()
  const recovered = f.store.getVerificationRun(old.id)!
  expect(recovered).toMatchObject({
    status: 'RUNNING',
    runtimeEpoch: 'epoch-after',
    claimCount: 2,
    verdictDetail: { phase: 'prepared' }
  })
  expect(recovered.worktreeId).not.toBe(old.worktreeId)
  expect(runtime.worktrees.some((w) => w.id === old.worktreeId)).toBe(false)
  const sequence = events(old.id).map((e) => e.event)
  expect(sequence).toEqual([
    'verification.claimed',
    'verification.prepared',
    'verification.recovery_failed',
    'verification.requeued',
    'verification.claimed',
    'verification.prepared'
  ])
  console.log('[M3-01-2 recovery]', JSON.stringify({ runId: old.id, sequence, claimCount: 2 }))
})

it('continues the boot-only orphan sweep past a failed removal and audits a known run', async () => {
  const service = new VerificationService(dependencies('epoch-one'))
  await service.kick()
  const current = f.store.getVerificationRun(f.run.id)
  const active = runtime.worktrees[0]
  runtime.worktrees.push(
    { ...active, id: 'repo::/orphan-failed', branch: `axiom/verify/${f.run.id}/0` },
    { ...active, id: 'repo::/orphan-removed', branch: 'axiom/verify/missing/0' },
    { ...active, id: 'repo::/attempt', branch: f.binding.branch }
  )
  const remove = runtime.removeManagedWorktree.getMockImplementation()!
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    if (selector === 'id:repo::/orphan-failed') {
      throw new Error('sensitive-runtime-output')
    }
    return remove(selector)
  })
  await service.recoverAtBoot()
  expect(runtime.worktrees.map((w) => w.id)).toEqual([
    active.id,
    'repo::/orphan-failed',
    'repo::/attempt'
  ])
  expect(console.warn).toHaveBeenCalledWith('[axiom] Verification recovery incomplete', {
    requeued: 0,
    cleaned: 1,
    failed: 1
  })
  expect(runtime.removeManagedWorktree).toHaveBeenCalledWith('id:repo::/orphan-removed')
  expect(f.store.getVerificationRun(f.run.id)).toEqual(current)
  expect(events(f.run.id).at(-1)).toMatchObject({
    event: 'verification.recovery_failed',
    after: { worktreeId: 'repo::/orphan-failed', reason: 'worktree_removal_failed' }
  })
  await service.kick()
  expect(runtime.listManagedWorktrees).toHaveBeenCalledTimes(1)
  // A new boot generation may record the unresolved failure once again.
  await service.recoverAtBoot()
  expect(events(f.run.id).filter((e) => e.event === 'verification.recovery_failed')).toHaveLength(2)
  expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(
    'sensitive-runtime-output'
  )
})

it('isolates INCONCLUSIVE cleanup failures and retries them without requeueing or reclaiming', async () => {
  const second = queueAnotherVerification(f)
  vi.mocked(pin.pinVerificationCandidate).mockRejectedValue(
    new pin.VerificationPreparationError('candidate_mismatch', 'Candidate mismatch.')
  )
  const remove = runtime.removeManagedWorktree.getMockImplementation()!
  runtime.removeManagedWorktree.mockRejectedValue(new Error('runtime unavailable'))
  await new VerificationService(dependencies('epoch-before')).kick()
  const old = f.store.getVerificationRun(f.run.id)!
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    if (selector === `id:${old.worktreeId}`) {
      throw new Error('runtime unavailable')
    }
    return remove(selector)
  })
  const service = new VerificationService(dependencies('epoch-after'))
  await service.recoverAtBoot()
  expect(f.store.getVerificationRun(old.id)).toMatchObject({
    status: 'INCONCLUSIVE',
    worktreeId: old.worktreeId,
    verdictDetail: { phase: 'prepare_failed', cleanupPending: true }
  })
  expect(f.store.getVerificationRun(second.id)).toMatchObject({
    status: 'INCONCLUSIVE',
    worktreeId: null,
    verdictDetail: { phase: 'prepare_failed', cleanupPending: false }
  })
  runtime.removeManagedWorktree.mockImplementation(remove)
  await service.kick()
  expect(f.store.getVerificationRun(old.id)).toMatchObject({
    status: 'INCONCLUSIVE',
    claimCount: 1,
    worktreeId: null,
    verdictDetail: { phase: 'prepare_failed', cleanupPending: false }
  })
  expect(runtime.worktrees).toEqual([])
  expect(events(old.id).map((e) => e.event)).toEqual([
    'verification.claimed',
    'verification.inconclusive',
    'verification.recovery_failed'
  ])
})

it('returns requeued, cleaned and failed counts for recovery logging', async () => {
  await new VerificationService(dependencies('epoch-before')).kick()
  const report = await recoverVerifications(dependencies('epoch-after'))
  expect(report).toEqual({ requeued: 1, cleaned: 0, failed: 0 })
  expect(await recoverVerifications(dependencies('epoch-after'))).toEqual({
    requeued: 0,
    cleaned: 0,
    failed: 0
  })
})
