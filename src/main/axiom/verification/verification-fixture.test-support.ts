import { vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { gitExecFileAsync } from '../../git/runner'
import type { Repo } from '../../../shared/repo-types'
import { fixture, planned } from '../mission-controller/controller-fixture.test-support'
import { ArtifactStore } from '../artifacts/artifact-store'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { RuntimeWorktreeRecord } from '../../../shared/runtime-worktree-contracts'
import type { RuntimeManagedWorktreeCreateArgs } from '../../runtime/runtime-managed-worktree-create-types'

export function verificationFixture(root: string, dbPath = ':memory:') {
  const f = planned(fixture(dbPath))
  f.controller.startExecution(f.missionId)
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
    missionId: f.missionId,
    taskId: task.taskId,
    seq: 1,
    branch: `axiom/attempt/${task.taskId}/1`,
    dispatchId: 'dispatch-1',
    agentSpecId: 'spec-1',
    contextPackageId: 'context-1'
  })
  const binding = f.store.getAttemptBinding(task.taskId, 1)!
  const candidate = f.store.insertCandidate({
    id: 'candidate-1',
    missionId: f.missionId,
    taskId: task.taskId,
    attemptId: 'dispatch-1',
    commitSha: 'a'.repeat(40),
    treeSha: 'b'.repeat(40),
    status: 'ACTIVE',
    supersededBy: null
  })
  const run = f.store.insertVerificationRun({
    id: 'vrun-1',
    missionId: f.missionId,
    taskId: task.taskId,
    candidateId: candidate.id,
    status: 'QUEUED',
    verdictDetail: {},
    commands: [],
    toolVersions: {},
    verifier: 'VerificationService'
  })
  const artifacts = new ArtifactStore(f.store, root)
  return { ...f, task, binding, candidate, run, artifacts }
}

export function queueAnotherVerification(f: ReturnType<typeof verificationFixture>) {
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
  return f.store.insertVerificationRun({
    ...f.run,
    id: 'vrun-2',
    taskId: task.taskId,
    candidateId: candidate.id
  })
}

export function verificationRuntime() {
  const showRepo = vi.fn(async (): Promise<Repo> => ({
    id: 'repo',
    path: '/repository',
    displayName: 'repository',
    badgeColor: '',
    addedAt: 0,
    connectionId: null
  }))
  const worktrees: RuntimeWorktreeRecord[] = []
  const createManagedWorktree = vi.fn(
    async (args: RuntimeManagedWorktreeCreateArgs): Promise<CreateWorktreeResult> => {
      const git = {
        path: `/verification/${args.name}`,
        head: 'a'.repeat(40),
        branch: args.branchNameOverride ?? '',
        isMainWorktree: false,
        isBare: false
      }
      const worktree: RuntimeWorktreeRecord = {
        ...git,
        git,
        id: `repo::${git.path}`,
        repoId: 'repo',
        displayName: args.name,
        comment: '',
        linkedIssue: null,
        linkedPR: null,
        linkedLinearIssue: null,
        isArchived: false,
        isUnread: false,
        isPinned: false,
        sortOrder: 0,
        lastActivityAt: 0,
        parentWorktreeId: null,
        childWorktreeIds: [],
        lineage: null
      }
      worktrees.push(worktree)
      return { worktree }
    }
  )
  const removeManagedWorktree = vi.fn(async (selector: string) => {
    const index = worktrees.findIndex((w) => `id:${w.id}` === selector)
    if (index !== -1) {
      worktrees.splice(index, 1)
    }
    return {}
  })
  const listManagedWorktrees = vi.fn(async () => ({
    worktrees: [...worktrees],
    totalCount: worktrees.length,
    truncated: false
  }))
  return { createManagedWorktree, removeManagedWorktree, listManagedWorktrees, worktrees, showRepo }
}

export async function verificationGitFixture(root: string) {
  const f = verificationFixture(path.join(root, 'artifacts'))
  const repo = path.join(root, 'repository')
  await mkdir(repo)
  const git = async (...args: string[]) =>
    (await gitExecFileAsync(args, { cwd: repo })).stdout.trim()
  await git('init', '-q')
  await git('config', 'user.name', 'Verification test')
  await git('config', 'user.email', 'verification@localhost')
  await git('config', 'core.hooksPath', '')
  await writeFile(path.join(repo, 'file.txt'), 'base')
  await git('add', 'file.txt')
  await git('commit', '--no-gpg-sign', '-qm', 'base')
  const baseSha = await git('rev-parse', 'HEAD')
  await git('branch', `axiom/integration/${f.missionId}`)
  const scopePath = f.task.spec.scope.allowedPaths[0]
  await mkdir(path.dirname(path.join(repo, scopePath)), { recursive: true })
  await writeFile(path.join(repo, scopePath), 'immutable candidate')
  await git('add', scopePath)
  await git('commit', '--no-gpg-sign', '-qm', 'candidate')
  await git('branch', f.binding.branch)
  f.candidate.commitSha = await git('rev-parse', 'HEAD')
  f.candidate.treeSha = await git('rev-parse', 'HEAD^{tree}')
  f.db.db
    .prepare('UPDATE candidates SET commit_sha = ?, tree_sha = ? WHERE id = ?')
    .run(f.candidate.commitSha, f.candidate.treeSha, f.candidate.id)
  const runtime = verificationRuntime()
  runtime.showRepo.mockResolvedValue({
    id: 'repo',
    path: repo,
    displayName: 'repository',
    badgeColor: '',
    addedAt: 0,
    connectionId: null
  })
  const create = runtime.createManagedWorktree.getMockImplementation()!
  runtime.createManagedWorktree.mockImplementation(async (args) => {
    const result = await create(args)
    const directory = path.join(root, args.name)
    await git('worktree', 'add', '-b', args.branchNameOverride!, directory, args.baseBranch!)
    result.worktree.id = `repo::${directory}`
    result.worktree.path = directory
    return result
  })
  const remove = runtime.removeManagedWorktree.getMockImplementation()!
  runtime.removeManagedWorktree.mockImplementation(async (selector) => {
    const worktree = runtime.worktrees.find((w) => `id:${w.id}` === selector)
    if (worktree) {
      await git('worktree', 'remove', '--force', worktree.path)
    }
    return remove(selector)
  })
  return { ...f, runtime, repo, git, baseSha, scopePath }
}
