import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { verificationFixture, verificationRuntime } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import * as pin from './verification-worktree'

let root: string
let f: ReturnType<typeof verificationFixture>
let runtime: ReturnType<typeof verificationRuntime>
let service: VerificationService
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'axiom-verification-'))
  f = verificationFixture(root)
  runtime = verificationRuntime()
  service = new VerificationService({
    store: f.store,
    missions: f.controller,
    artifacts: f.artifacts,
    runtime,
    runtimeEpoch: 'epoch-one'
  })
  vi.spyOn(pin, 'pinVerificationCandidate').mockResolvedValue(undefined)
})
afterEach(async () => {
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})
const events = () =>
  f.store
    .listAuditEvents({ missionId: f.missionId })
    .filter((e) => e.objectKind === 'verification_run')

it('claims exactly once under concurrent claimNext calls and moves the Task atomically', async () => {
  const results = await Promise.all([service.claimNext(), service.claimNext()])
  expect(results.filter(Boolean)).toHaveLength(1)
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'RUNNING',
    runtimeEpoch: 'epoch-one',
    claimCount: 1,
    startedAt: expect.any(String),
    verdictDetail: { phase: 'claimed', claim: 1 }
  })
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
  expect(events()).toMatchObject([
    {
      event: 'verification.claimed',
      objectId: f.run.id,
      after: { status: 'RUNNING', taskId: f.task.taskId, candidateId: f.candidate.id, claim: 1 }
    }
  ])
})

it('writes nothing when the claim CAS loses and rolls back when stage transition fails', () => {
  const before = f.store.getVerificationRun(f.run.id)
  vi.spyOn(f.store, 'claimVerificationRun').mockReturnValueOnce(undefined)
  expect(service.claimNext()).toBeUndefined()
  expect(f.store.getVerificationRun(f.run.id)).toEqual(before)
  expect(events()).toEqual([])
  vi.spyOn(f.controller, 'transitionTaskStage').mockImplementationOnce(() => {
    throw new Error('stage failure')
  })
  expect(() => service.claimNext()).toThrow('stage failure')
  expect(f.store.getVerificationRun(f.run.id)).toEqual(before)
  expect(events()).toEqual([])
})

it.each(['candidate_superseded', 'task_stage_changed'] as const)(
  'cancels obsolete queued runs: %s',
  (reason) => {
    if (reason === 'candidate_superseded') {
      f.store.supersedeActiveCandidates(f.task.taskId, 'new-candidate')
    } else {
      f.controller.cancelTask({ taskId: f.task.taskId, rationale: 'Canceled', actor: 'tester' })
    }
    expect(service.claimNext()).toBeUndefined()
    expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
      status: 'CANCELED',
      claimCount: 0,
      verdictDetail: { phase: 'canceled', reason }
    })
    expect(events()).toMatchObject([{ event: 'verification.canceled' }])
  }
)

it('coalesces kicks, prepares only once outside the claim transaction and records evidence', async () => {
  const create = runtime.createManagedWorktree.getMockImplementation()!
  runtime.createManagedWorktree.mockImplementationOnce(async (args) => {
    expect(f.db.db.isTransaction).toBe(false)
    expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.phase).toBe('claimed')
    return create(args)
  })
  const first = service.kick(f.missionId)
  expect(service.kick()).toBe(first)
  await first
  await service.kick()
  expect(runtime.createManagedWorktree).toHaveBeenCalledExactlyOnceWith({
    repoSelector: 'id:repo',
    name: `verify-${f.task.taskId}-1`,
    baseBranch: f.binding.branch,
    branchNameOverride: `axiom/verify/${f.run.id}/1`,
    runHooks: false,
    setupDecision: 'skip',
    awaitTerminalProvisioning: false,
    observeSetupCompletion: false,
    activate: false,
    lineage: {
      noParent: true,
      orchestrationContext: {
        orchestrationRunId: f.controller.getMission(f.missionId).runId,
        taskId: f.task.taskId
      }
    }
  })
  const run = f.store.getVerificationRun(f.run.id)!
  expect(run).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
    verdictDetail: {
      phase: 'prepared',
      claim: 1,
      worktreeId: run.worktreeId,
      candidateCommitSha: f.candidate.commitSha,
      candidateTreeSha: f.candidate.treeSha,
      baseline: { branch: f.binding.branch },
      evidenceArtifactIds: [expect.any(String)]
    }
  })
  const evidence = f.artifacts.list({ missionId: f.missionId, kind: 'evidence' })
  expect(evidence).toHaveLength(1)
  expect(evidence[0]).toMatchObject({
    createdBy: 'VerificationService',
    related: [run.id, run.taskId, run.candidateId],
    mediaType: 'application/json'
  })
  expect(JSON.parse((await f.artifacts.read(evidence[0].id)).content.toString())).toMatchObject({
    phase: 'prepared',
    candidateCommitSha: f.candidate.commitSha,
    preparedAt: expect.any(String),
    startedAt: run.startedAt
  })
  expect(events().map((e) => e.event)).toEqual(['verification.claimed', 'verification.prepared'])
})

it('does not lose a kick arriving as an empty drain finishes', async () => {
  let trailing: Promise<void> | undefined
  vi.spyOn(service, 'claimNext').mockImplementationOnce(() => {
    queueMicrotask(() => {
      trailing = service.kick(f.missionId)
    })
    return undefined
  })
  await service.kick()
  await trailing
  expect(f.store.getVerificationRun(f.run.id)?.verdictDetail.phase).toBe('prepared')
})

it('prepares two Tasks serially even when another kick arrives during Git IO', async () => {
  const task = f.store.listTaskStages({ missionId: f.missionId, stage: 'READY' })[0]
  f.controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'RUNNING',
    actor: 'Scheduler',
    attemptCountDelta: 1,
    reason: 'admission'
  })
  f.controller.transitionTaskStage({
    taskId: task.taskId,
    to: 'SUBMITTED',
    actor: 'AttemptSettlement',
    reason: 'submission'
  })
  f.store.insertAttemptBinding({
    ...f.binding,
    taskId: task.taskId,
    dispatchId: 'dispatch-2',
    branch: `axiom/attempt/${task.taskId}/1`
  })
  const candidate = f.store.insertCandidate({
    ...f.candidate,
    id: 'candidate-2',
    taskId: task.taskId,
    attemptId: 'dispatch-2'
  })
  f.store.insertVerificationRun({
    ...f.run,
    id: 'vrun-2',
    taskId: task.taskId,
    candidateId: candidate.id
  })
  let release!: () => void
  let entered!: () => void
  const inGit = new Promise<void>((resolve) => {
    entered = resolve
  })
  vi.mocked(pin.pinVerificationCandidate).mockImplementationOnce(async () => {
    entered()
    await new Promise<void>((resolve) => {
      release = resolve
    })
  })
  const drain = service.kick()
  await inGit
  expect(service.kick(f.missionId)).toBe(drain)
  expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(1)
  expect(f.store.getVerificationRun('vrun-2')?.status).toBe('QUEUED')
  release()
  await drain
  expect(runtime.createManagedWorktree).toHaveBeenCalledTimes(2)
  expect(
    f.store.listVerificationRuns({ missionId: f.missionId }).map((run) => run.verdictDetail.phase)
  ).toEqual(['prepared', 'prepared'])
})

it('fences stale outcome writes by epoch and claim count', () => {
  service.claimNext()
  expect(
    f.store.updateVerificationRun({
      id: f.run.id,
      expectedStatus: 'RUNNING',
      expectedRuntimeEpoch: 'old-epoch',
      expectedClaimCount: 1,
      status: 'INCONCLUSIVE'
    })
  ).toBe(false)
  expect(
    f.store.updateVerificationRun({
      id: f.run.id,
      expectedStatus: 'RUNNING',
      expectedRuntimeEpoch: 'epoch-one',
      expectedClaimCount: 2,
      worktreeId: 'wrong'
    })
  ).toBe(false)
  expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
    status: 'RUNNING',
    claimCount: 1,
    worktreeId: null
  })
})

it.each(['candidate_missing', 'candidate_mismatch', 'worktree_unavailable'] as const)(
  'records %s as INCONCLUSIVE, cleans up its worktree and leaves the Task VERIFYING',
  async (reason) => {
    if (reason === 'worktree_unavailable') {
      runtime.createManagedWorktree.mockRejectedValueOnce(new Error('unavailable'))
    } else {
      vi.mocked(pin.pinVerificationCandidate).mockRejectedValueOnce(
        new pin.VerificationPreparationError(reason, 'Candidate cannot be pinned')
      )
    }
    await service.kick()
    expect(f.store.getVerificationRun(f.run.id)).toMatchObject({
      status: 'INCONCLUSIVE',
      finishedAt: expect.any(String),
      worktreeId: null,
      verdictDetail: { phase: 'prepare_failed', reason, detail: expect.any(String) }
    })
    expect(runtime.removeManagedWorktree).toHaveBeenCalledTimes(
      reason === 'worktree_unavailable' ? 0 : 1
    )
    expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
    expect(events().map((e) => e.event)).toEqual([
      'verification.claimed',
      'verification.inconclusive'
    ])
  }
)
