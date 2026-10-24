import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import type { VerificationDependencies } from './verification-service'
import { auditVerification } from './verification-claim'
import { isLocalVerificationRepository } from './verification-checks'
import {
  pinVerificationCandidate,
  removeVerificationWorktree,
  VerificationPreparationError
} from './verification-worktree'

export async function prepareVerification(
  deps: VerificationDependencies,
  run: VerificationRun
): Promise<VerificationRun | undefined> {
  const { store, runtime, runtimeEpoch, artifacts, missions } = deps
  const fence = {
    id: run.id,
    expectedStatus: 'RUNNING' as const,
    expectedRuntimeEpoch: runtimeEpoch,
    expectedClaimCount: run.claimCount
  }
  let worktreeId: string | null = null
  try {
    const candidate = store.getCandidate(run.candidateId)
    if (!candidate) {
      throw new VerificationPreparationError(
        'candidate_missing',
        'Verification Candidate is missing.'
      )
    }
    const mission = missions.getMission(run.missionId)
    // Unsupported hosts are settled by the check runner without touching their filesystem.
    if (!isLocalVerificationRepository(await runtime.showRepo(`id:${mission.repoId}`))) {
      return run
    }
    const binding = store.getAttemptBindingByDispatch(candidate.attemptId)
    if (!binding || binding.taskId !== run.taskId || binding.missionId !== run.missionId) {
      throw new VerificationPreparationError(
        'worktree_unavailable',
        'Candidate Attempt binding is unavailable.'
      )
    }
    const branch = `axiom/verify/${run.id}/${run.claimCount}`
    const created = await runtime.createManagedWorktree({
      repoSelector: `id:${mission.repoId}`,
      name: `verify-${run.taskId}-${run.claimCount}`,
      baseBranch: binding.branch,
      branchNameOverride: branch,
      runHooks: false,
      setupDecision: 'skip',
      awaitTerminalProvisioning: false,
      observeSetupCompletion: false,
      activate: false,
      lineage: {
        noParent: true,
        orchestrationContext: { orchestrationRunId: mission.runId, taskId: run.taskId }
      }
    })
    worktreeId = created.worktree.id
    // Persist ownership before detaching: runtime listings may then show only detached HEAD.
    if (!store.updateVerificationRun({ ...fence, worktreeId })) {
      await removeVerificationWorktree(runtime, worktreeId)
      return
    }
    await pinVerificationCandidate(worktreeId, branch, candidate)
    const prepared = {
      phase: 'prepared',
      claim: run.claimCount,
      worktreeId,
      candidateCommitSha: candidate.commitSha,
      candidateTreeSha: candidate.treeSha,
      baseline: { branch: binding.branch }
    }
    const evidence = await artifacts.put({
      missionId: run.missionId,
      kind: 'evidence',
      mediaType: 'application/json',
      related: [run.id, run.taskId, run.candidateId],
      createdBy: 'VerificationService',
      content: Buffer.from(
        JSON.stringify({
          ...prepared,
          runtimeEpoch,
          startedAt: run.startedAt,
          preparedAt: new Date().toISOString()
        })
      )
    })
    const saved = store.transaction('verification_prepared', () => {
      const verdictDetail = { ...prepared, evidenceArtifactIds: [evidence.id] }
      if (!store.updateVerificationRun({ ...fence, worktreeId, verdictDetail })) {
        return false
      }
      auditVerification(deps, run, 'verification.prepared', { status: 'RUNNING', ...verdictDetail })
      return true
    })
    if (!saved) {
      await removeVerificationWorktree(runtime, worktreeId)
    } else {
      return store.getVerificationRun(run.id)
    }
  } catch (error) {
    let cleanupFailed = false
    if (worktreeId) {
      try {
        await removeVerificationWorktree(runtime, worktreeId)
        worktreeId = null
      } catch {
        cleanupFailed = true
      }
    }
    // Never persist raw Git/hook/runtime output (which can include credentials).
    const failure =
      error instanceof VerificationPreparationError
        ? error
        : new VerificationPreparationError(
            'worktree_unavailable',
            'Verification worktree preparation failed.'
          )
    const verdictDetail = {
      phase: 'prepare_failed',
      reason: failure.reason,
      detail: failure.message,
      ...(cleanupFailed ? { cleanupPending: true } : {})
    }
    store.transaction('verification_prepare_failed', () => {
      if (
        !store.updateVerificationRun({
          ...fence,
          status: 'INCONCLUSIVE',
          worktreeId,
          finishedAt: new Date().toISOString(),
          verdictDetail
        })
      ) {
        return
      }
      auditVerification(deps, run, 'verification.inconclusive', {
        status: 'INCONCLUSIVE',
        ...verdictDetail
      })
    })
  }
  return undefined
}
