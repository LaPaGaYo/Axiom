import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { AxiomStore } from '../db/axiom-store'
import { previousAttemptSubmission, type AttemptBaseline } from './attempt-baseline'

export function attemptBaselineAudit(baseline: AttemptBaseline): Record<string, string> {
  return baseline.kind === 'candidate'
    ? {
        kind: baseline.kind,
        candidateId: baseline.candidate.id,
        commitSha: baseline.candidate.commitSha
      }
    : { kind: baseline.kind, reason: baseline.reason }
}

export async function prepareWorkerFixLaunch(
  db: OrchestrationDb,
  store: AxiomStore,
  attempt: { taskId: string; seq: number },
  baseline: AttemptBaseline,
  worktree: Pick<CreateWorktreeResult['worktree'], 'path' | 'git'>
) {
  if (baseline.kind === 'candidate') {
    const head =
      worktree.git?.head ??
      (
        await gitExecFileAsync(['rev-parse', 'HEAD'], gitOptionsForWorktree(worktree.path))
      ).stdout.trim()
    if (head !== baseline.candidate.commitSha) {
      throw new Error('fix_base_mismatch')
    }
  }
  let existingTask = db.getTask(attempt.taskId)
  let orcaTaskReopened = false
  if (existingTask?.status === 'completed' && previousAttemptSubmission(store, attempt)) {
    // The public kernel transition refuses to reopen under an active dispatch.
    db.updateTaskStatus(attempt.taskId, 'ready')
    existingTask = db.getTask(attempt.taskId)
    orcaTaskReopened = true
  }
  if (!existingTask) {
    throw new Error('task_not_found')
  }
  return { existingTask, orcaTaskReopened }
}
