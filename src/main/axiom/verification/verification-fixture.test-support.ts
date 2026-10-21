import { vi } from 'vitest'
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

export function verificationRuntime() {
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
  return { createManagedWorktree, removeManagedWorktree, listManagedWorktrees, worktrees }
}
