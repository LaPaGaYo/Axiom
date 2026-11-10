import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import { gitExecFileAsync } from '../../git/runner'
import { gitOptionsForWorktree } from '../../git/git-runtime-options'
import type { OrchestrationDb } from '../../runtime/orchestration/db'
import type { AxiomStore } from '../db/axiom-store'
import { previousAttemptSubmission, type AttemptBaseline } from './attempt-baseline'

export function attemptBaselineRef(baseline: AttemptBaseline | undefined, missionId: string) {
  return baseline?.kind === 'snapshot'
    ? baseline.snapshot.commitSha
    : baseline?.kind === 'candidate'
      ? baseline.candidate.commitSha
      : `axiom/integration/${missionId}`
}

export function attemptBaselineAudit(baseline: AttemptBaseline): AuditEvent['after'] {
  const selection: Record<string, NonNullable<AuditEvent['after']>> = {}
  if (baseline.notContinued?.length) {
    selection.strategy = 'not_continued'
    selection.notContinued = baseline.notContinued
  }
  if (baseline.kind === 'snapshot') {
    return {
      ...selection,
      kind: baseline.kind,
      strategy: 'continued',
      reason: 'preserved_snapshot',
      previousSeq: baseline.previousSeq,
      attemptId: baseline.attemptId,
      commitSha: baseline.snapshot.commitSha
    }
  }
  return baseline.kind === 'candidate'
    ? {
        ...selection,
        kind: baseline.kind,
        candidateId: baseline.candidate.id,
        commitSha: baseline.candidate.commitSha
      }
    : { ...selection, kind: baseline.kind, reason: baseline.reason }
}

export async function prepareWorkerFixLaunch(
  db: OrchestrationDb,
  store: AxiomStore,
  attempt: { taskId: string; seq: number },
  baseline: AttemptBaseline,
  worktree: Pick<CreateWorktreeResult['worktree'], 'path' | 'git'>
) {
  if (baseline.kind === 'candidate' || baseline.kind === 'snapshot') {
    const head =
      worktree.git?.head ??
      (
        await gitExecFileAsync(['rev-parse', 'HEAD'], gitOptionsForWorktree(worktree.path))
      ).stdout.trim()
    if (head !== attemptBaselineRef(baseline, '')) {
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
