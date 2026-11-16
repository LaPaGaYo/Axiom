import { mkdtemp, mkdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gitAt, kernelWorktreeRuntime } from '../integration/integration-fixture.test-support'
import { verificationGitFixture } from './verification-fixture.test-support'
import { VerificationService } from './verification-service'
import { prepareVerification } from './verification-prepare'
import { recoverVerifications } from './verification-recovery'
import * as worktree from './verification-worktree'
import * as runner from '../../git/runner'

let root: string
let f: Awaited<ReturnType<typeof verificationGitFixture>>
let runtime: ReturnType<typeof kernelWorktreeRuntime>
let service: VerificationService
const deps = (runtimeEpoch = 'current') => ({
  store: f.store,
  missions: f.controller,
  artifacts: f.artifacts,
  runtime,
  runtimeEpoch
})
const saved = () => f.store.getVerificationRun(f.run.id)!
const branch = () => `axiom/verify/${f.run.id}/1`
beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'axiom-verification-branch-')))
  f = await verificationGitFixture(root)
  runtime = kernelWorktreeRuntime(f, root)
  service = new VerificationService(deps())
})
afterEach(async () => {
  await service.stop()
  vi.restoreAllMocks()
  f.db.close()
  await rm(root, { recursive: true, force: true })
})

it('deletes the verification branch with its worktree after a verdict', async () => {
  await f.git('checkout', '--detach', f.baseSha)
  const origin = path.join(root, 'origin')
  await mkdir(origin)
  await gitAt(origin, 'init', '-q')
  await gitAt(origin, 'config', 'core.bare', 'true')
  await f.git('remote', 'add', 'origin', origin)
  await f.git('push', 'origin', `${f.baseSha}:refs/heads/main`)
  await gitAt(origin, 'branch', 'unfetched', 'main')
  await f.git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main')
  const before = await f.git('worktree', 'list', '--porcelain')
  const command =
    `node -e "const fs=require('node:fs');` +
    `fs.writeFileSync('file.txt','changed by verification');fs.writeFileSync('untracked','left behind')"`
  f.db.db.prepare('UPDATE task_stages SET spec = ? WHERE task_id = ?').run(
    JSON.stringify({
      ...f.task.spec,
      requiredEvidence: undefined,
      acceptanceCriteria: [{ text: 'Check passes', check: { kind: 'command', command } }]
    }),
    f.task.taskId
  )
  const remove = runtime.removeManagedWorktree.getMockImplementation()!
  const contents: string[] = []
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    const row = runtime.worktrees.find((w) => `id:${w.id}` === selector)!
    contents.push(await readFile(path.join(row.path, 'file.txt'), 'utf8'))
    contents.push(await readFile(path.join(row.path, 'untracked'), 'utf8'))
    return remove(selector)
  })
  const git = vi.spyOn(runner, 'gitExecFileAsync')
  await service.kick()
  expect(await f.git('for-each-ref', 'refs/heads/axiom/verify')).toBe('')
  expect(await f.git('worktree', 'list', '--porcelain')).toBe(before)
  expect(await f.git('rev-parse', f.binding.branch)).toBe(f.candidate.commitSha)
  expect(await f.git('rev-parse', `axiom/integration/${f.missionId}`)).toBe(f.baseSha)
  expect(await f.git('for-each-ref', 'refs/remotes/origin/unfetched')).toBe('')
  expect(contents).toEqual(['changed by verification', 'left behind'])
  expect(saved()).toMatchObject({
    status: 'PASS',
    worktreeId: null,
    verdictDetail: { cleanupPending: false, checks: [{ result: 'pass' }] }
  })
  const calls = git.mock.calls.map(([args]) => args)
  expect(calls).toContainEqual(['branch', '-d', '--', branch()])
  expect(calls.some((args) => args.includes('merge-tree'))).toBe(true)
  expect(calls).toContainEqual([
    'update-ref',
    '-d',
    `refs/heads/${branch()}`,
    f.candidate.commitSha
  ])
  expect(calls.some((args) => args.includes('fetch'))).toBe(false)
})

it('deletes the verification branch when preparation fails after the worktree was made', async () => {
  f.db.db
    .prepare('UPDATE candidates SET tree_sha = ? WHERE id = ?')
    .run(await f.git('rev-parse', `${f.baseSha}^{tree}`), f.candidate.id)
  const before = await f.git('worktree', 'list', '--porcelain')
  const git = vi.spyOn(runner, 'gitExecFileAsync')
  await prepareVerification(deps(), service.claimNext()!)
  expect(await f.git('for-each-ref', 'refs/heads/axiom/verify')).toBe('')
  expect(await f.git('worktree', 'list', '--porcelain')).toBe(before)
  expect(saved()).toMatchObject({
    status: 'HUMAN_REVIEW',
    worktreeId: null,
    verdictDetail: { phase: 'prepare_failed', reason: 'candidate_mismatch' }
  })
  expect(git.mock.calls.some(([args]) => args.includes('--detach'))).toBe(true)
  expect(f.store.getTaskStage(f.task.taskId)?.stage).toBe('VERIFYING')
})

it('deletes the branch of an interrupted run before it is queued again', async () => {
  const before = await f.git('worktree', 'list', '--porcelain')
  await prepareVerification(deps(), service.claimNext()!)
  const directory = runtime.worktrees[0].path
  expect(saved()).toMatchObject({ status: 'RUNNING', verdictDetail: { phase: 'prepared' } })
  await expect(gitAt(directory, 'symbolic-ref', '-q', 'HEAD')).rejects.toMatchObject({ code: 1 })
  const report = await recoverVerifications(deps('next-epoch'))
  expect(await f.git('for-each-ref', 'refs/heads/axiom/verify')).toBe('')
  expect(await f.git('worktree', 'list', '--porcelain')).toBe(before)
  expect(report).toEqual({ requeued: 1, cleaned: 0, failed: 0 })
  expect(saved()).toMatchObject({
    status: 'QUEUED',
    worktreeId: null,
    runtimeEpoch: null,
    verdictDetail: { phase: 'requeued', reason: 'restart', previousClaim: 1 }
  })
  expect(f.store.listAuditEvents({ missionId: f.missionId })).toContainEqual(
    expect.objectContaining({
      event: 'verification.requeued',
      objectId: f.run.id,
      after: { status: 'QUEUED', reason: 'restart', previousClaim: 1 }
    })
  )
})

it('sweeps an unrecorded verification worktree that the listing names by its full ref', async () => {
  vi.spyOn(worktree, 'pinVerificationCandidate').mockResolvedValue(undefined)
  await prepareVerification(deps(), service.claimNext()!)
  const active = runtime.worktrees[0]
  const current = saved()
  const orphan = (
    await runtime.createManagedWorktree({
      repoSelector: 'id:repo',
      name: 'unrecorded',
      baseBranch: f.binding.branch,
      branchNameOverride: 'axiom/verify/unrecorded/1'
    })
  ).worktree
  const other = (
    await runtime.createManagedWorktree({
      repoSelector: 'id:repo',
      name: 'unrelated',
      baseBranch: f.binding.branch,
      branchNameOverride: 'unrelated'
    })
  ).worktree
  expect((await runtime.listManagedWorktrees()).worktrees.map((w) => w.branch)).toContain(
    'refs/heads/axiom/verify/unrecorded/1'
  )
  const report = await recoverVerifications(deps())
  expect(await f.git('worktree', 'list', '--porcelain')).not.toContain(orphan.path)
  expect(await f.git('for-each-ref', 'refs/heads/axiom/verify/unrecorded/1')).toBe('')
  const listed = await f.git('worktree', 'list', '--porcelain')
  expect(listed).toContain(active.path)
  expect(listed).toContain(other.path)
  expect(await f.git('rev-parse', `refs/heads/${branch()}`)).toBe(f.candidate.commitSha)
  expect(await f.git('rev-parse', 'refs/heads/unrelated')).toBe(f.candidate.commitSha)
  expect(saved()).toEqual(current)
  expect(report).toEqual({ requeued: 0, cleaned: 1, failed: 0 })
  expect(runtime.removeManagedWorktree).toHaveBeenCalledExactlyOnceWith(`id:${orphan.id}`)
})
