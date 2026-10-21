import type { VerificationDependencies } from './verification-service'
import type { VerificationRun } from '../../../shared/axiom-contract/verification-params'
import { auditVerification } from './verification-claim'
import { removeVerificationWorktree } from './verification-worktree'

export type VerificationRecoveryReport = { requeued: number; cleaned: number; failed: number }

function recordRemovalFailure(
  deps: VerificationDependencies,
  run: VerificationRun | undefined,
  worktreeId: string,
  reportedFailures: Set<string>
): void {
  console.warn('[axiom] Verification worktree recovery failed', { worktreeId })
  if (!run) {
    return
  }
  try {
    const recorded = deps.store.transaction('verification_recovery_failed', () => {
      // An orphan may belong to an older claim; never mark the current worktree for cleanup.
      if (run.worktreeId === worktreeId && run.verdictDetail.cleanupPending !== true) {
        if (
          !deps.store.updateVerificationRun({
            id: run.id,
            expectedStatus: run.status,
            expectedRuntimeEpoch: run.runtimeEpoch,
            expectedClaimCount: run.claimCount,
            verdictDetail: { ...run.verdictDetail, cleanupPending: true }
          })
        ) {
          return false
        }
      }
      if (!reportedFailures.has(run.id)) {
        auditVerification(deps, run, 'verification.recovery_failed', {
          worktreeId,
          reason: 'worktree_removal_failed'
        })
      }
      return true
    })
    if (recorded) {
      reportedFailures.add(run.id)
    }
  } catch {
    // Failed evidence persistence must not prevent cleanup of the remaining runs.
    console.warn('[axiom] Verification recovery failure could not be recorded', { runId: run.id })
  }
}

export async function recoverVerifications(
  deps: VerificationDependencies,
  { sweepOrphans = true, reportedFailures = new Set<string>() } = {}
): Promise<VerificationRecoveryReport> {
  const { store, runtime, runtimeEpoch } = deps
  const report = { requeued: 0, cleaned: 0, failed: 0 }
  const handledWorktrees = new Set<string>()
  const pending = [
    ...store.listVerificationRunsByStatus('RUNNING').filter((r) => r.runtimeEpoch !== runtimeEpoch),
    ...store
      .listVerificationRunsByStatus('INCONCLUSIVE')
      .filter((r) => r.worktreeId && r.verdictDetail.cleanupPending === true)
  ]
  for (const run of pending) {
    if (run.worktreeId) {
      handledWorktrees.add(run.worktreeId)
      try {
        await removeVerificationWorktree(runtime, run.worktreeId)
      } catch {
        report.failed += 1
        recordRemovalFailure(deps, run, run.worktreeId, reportedFailures)
        continue
      }
    }
    try {
      const requeue = run.status === 'RUNNING'
      const saved = store.transaction('verification_requeue', () => {
        if (
          !store.updateVerificationRun({
            id: run.id,
            expectedStatus: run.status,
            expectedRuntimeEpoch: run.runtimeEpoch,
            expectedClaimCount: run.claimCount,
            worktreeId: null,
            ...(requeue
              ? {
                  status: 'QUEUED' as const,
                  runtimeEpoch: null,
                  verdictDetail: {
                    phase: 'requeued',
                    reason: 'restart',
                    previousClaim: run.claimCount
                  }
                }
              : { verdictDetail: { ...run.verdictDetail, cleanupPending: false } })
          })
        ) {
          return false
        }
        if (requeue) {
          auditVerification(deps, run, 'verification.requeued', {
            status: 'QUEUED',
            reason: 'restart',
            previousClaim: run.claimCount
          })
        }
        return true
      })
      if (saved) {
        report[requeue ? 'requeued' : 'cleaned'] += 1
      }
    } catch {
      report.failed += 1
      console.warn('[axiom] Verification recovery could not be persisted', { runId: run.id })
    }
  }
  if (!sweepOrphans) {
    return report
  }
  let listed: Awaited<ReturnType<typeof runtime.listManagedWorktrees>>
  try {
    listed = await runtime.listManagedWorktrees(undefined, Number.MAX_SAFE_INTEGER)
  } catch {
    console.warn('[axiom] Verification orphan listing failed')
    report.failed += 1
    return report
  }
  for (const worktree of listed.worktrees) {
    if (!worktree.branch.startsWith('axiom/verify/') || handledWorktrees.has(worktree.id)) {
      continue
    }
    let run: VerificationRun | undefined
    try {
      const runId = worktree.branch.split('/')[2]
      run = runId ? store.getVerificationRun(runId) : undefined
      if (
        run?.status === 'RUNNING' &&
        run.runtimeEpoch === runtimeEpoch &&
        run.worktreeId === worktree.id
      ) {
        continue
      }
      // Unrecorded orphans are identified by the runtime's listing; never force their removal.
      await runtime.removeManagedWorktree(`id:${worktree.id}`)
      report.cleaned += 1
    } catch {
      report.failed += 1
      recordRemovalFailure(deps, run, worktree.id, reportedFailures)
    }
  }
  return report
}
