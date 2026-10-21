import type { VerificationDependencies } from './verification-service'
import { auditVerification } from './verification-claim'
import { removeVerificationWorktree } from './verification-worktree'

export async function recoverVerifications(deps: VerificationDependencies): Promise<void> {
  const { store, runtime, runtimeEpoch } = deps
  for (const run of store.listVerificationRunsByStatus('RUNNING')) {
    if (run.runtimeEpoch === runtimeEpoch) {
      continue
    }
    if (run.worktreeId) {
      await removeVerificationWorktree(runtime, run.worktreeId)
    }
    store.transaction('verification_requeue', () => {
      if (
        !store.updateVerificationRun({
          id: run.id,
          expectedStatus: 'RUNNING',
          expectedRuntimeEpoch: run.runtimeEpoch,
          expectedClaimCount: run.claimCount,
          status: 'QUEUED',
          worktreeId: null,
          runtimeEpoch: null,
          verdictDetail: { phase: 'requeued', reason: 'restart', previousClaim: run.claimCount }
        })
      ) {
        return
      }
      auditVerification(deps, run, 'verification.requeued', {
        status: 'QUEUED',
        reason: 'restart',
        previousClaim: run.claimCount
      })
    })
  }
  // A cleanup error retains its id so detached worktrees remain discoverable at the next boot.
  for (const run of store.listVerificationRunsByStatus('INCONCLUSIVE')) {
    if (run.worktreeId && run.verdictDetail.cleanupPending === true) {
      await removeVerificationWorktree(runtime, run.worktreeId)
      store.updateVerificationRun({
        id: run.id,
        expectedStatus: 'INCONCLUSIVE',
        worktreeId: null,
        verdictDetail: { ...run.verdictDetail, cleanupPending: false }
      })
    }
  }
  const listed = await runtime.listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
  for (const worktree of listed.worktrees) {
    if (!worktree.branch.startsWith('axiom/verify/')) {
      continue
    }
    const runId = worktree.branch.split('/')[2]
    const run = runId ? store.getVerificationRun(runId) : undefined
    if (
      run?.status === 'RUNNING' &&
      run.runtimeEpoch === runtimeEpoch &&
      run.worktreeId === worktree.id
    ) {
      continue
    }
    // Unrecorded orphans are identified by the runtime's listing; do not force removal of them.
    await runtime.removeManagedWorktree(`id:${worktree.id}`)
  }
}
