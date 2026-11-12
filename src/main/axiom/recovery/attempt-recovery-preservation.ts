import { TERMINAL_MISSION_STATUSES } from '../../../shared/axiom-contract/lifecycle'
import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import { collectAttemptPreservation } from '../execution/attempt-preservation'
import { isHeadlessAttempt } from '../execution/attempt-exit-submission'
import { headlessAttemptDirectory, readHeadlessFile } from '../execution/headless-attempt-files'
import {
  readHeadlessLaunchRecord,
  resolveHeadlessLaunchRecord,
  headlessLaunchProvider
} from '../execution/headless-launch-record'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'
import { isRestartTerminalMissing } from './attempt-daemon-loss'

/** Caller supplies host exit proof or the accepted kernel loss verdict before worktree IO. */
export async function captureRecoveryAttempt(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  proof: 'stopped' | 'exited' | 'terminal_missing'
) {
  try {
    if (!binding.dispatchId) {
      return undefined
    }
    const worker = ctx.db.getWorkerDispatch(binding.dispatchId)
    if (
      !isHeadlessAttempt(worker) ||
      (proof === 'stopped' && worker?.state !== 'stopped') ||
      (proof === 'terminal_missing' &&
        !isRestartTerminalMissing(worker, ctx.runtime.getRuntimeId()))
    ) {
      return undefined
    }
    const directory = headlessAttemptDirectory(binding.dispatchId)
    const record = await readHeadlessLaunchRecord(directory)
    const launch = resolveHeadlessLaunchRecord(record, worker, binding)
    const provider = headlessLaunchProvider(ctx.store, binding, worker)
    const eventsText = (await readHeadlessFile(directory, 'events.jsonl')) ?? ''
    const task = ctx.store.getTaskStage(binding.taskId)
    if (!task) {
      return undefined
    }
    return await collectAttemptPreservation(ctx.artifacts, {
      attemptId: binding.dispatchId,
      taskId: binding.taskId,
      seq: binding.seq,
      missionId: binding.missionId,
      launch,
      provider,
      eventsText,
      allowedPaths: task.spec.scope.allowedPaths,
      verificationRules: ctx.store.getPolicy(binding.missionId)?.verificationRules
    })
  } catch {
    // Missing or untrusted launch data and storage failures do not delay the original ending.
    return undefined
  }
}

/** Async capture can lose to submission, cancellation or another kernel ending. */
export function recoveryEndingStillCurrent(
  ctx: RecoveryContext,
  binding: AttemptBinding,
  expected: WorkerDispatchRow | undefined
): boolean {
  const { store, db } = ctx
  const mission = store.getMission(binding.missionId)
  const current = store.getAttemptBinding(binding.taskId, binding.seq)
  const worker = binding.dispatchId ? db.getWorkerDispatch(binding.dispatchId) : undefined
  return Boolean(
    binding.dispatchId &&
    expected &&
    worker &&
    mission &&
    !TERMINAL_MISSION_STATUSES.has(mission.status) &&
    store.getTaskStage(binding.taskId)?.stage === 'RUNNING' &&
    store.nextAttemptSeq(binding.taskId) === binding.seq + 1 &&
    !store.getSubmissionByDispatch(binding.dispatchId) &&
    current?.dispatchId === binding.dispatchId &&
    current.branch === binding.branch &&
    current.agentSpecId === binding.agentSpecId &&
    db.getDispatchContext(binding.taskId)?.id === binding.dispatchId &&
    worker.state === expected.state &&
    worker.worktree_id === expected.worktree_id &&
    worker.start_options === expected.start_options &&
    worker.runtime_epoch === expected.runtime_epoch
  )
}
