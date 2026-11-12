import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import type { AttemptLauncherDependencies } from './attempt-launch-contract'
import type { AttemptBaseline } from './attempt-baseline'
import { continuationReaders } from './in-place-evidence'
import {
  continuationSession,
  decideInPlaceContinuation,
  type InPlaceContinuation
} from './in-place-continuation'
import { takeOverContinuationWorktree } from './in-place-worktree'

export type AttemptWorktree = Pick<CreateWorktreeResult['worktree'], 'id' | 'path' | 'git'>

export async function placeAttemptWorktree(input: {
  deps: AttemptLauncherDependencies
  attempt: AdmittedAttempt
  spec: AgentSpec
  baseline?: AttemptBaseline
  headless: boolean
  audit: Record<string, AuditEvent['after']>
  create: () => Promise<AttemptWorktree>
}): Promise<{ worktree: AttemptWorktree; continuation?: InPlaceContinuation }> {
  if (input.headless && input.baseline && input.attempt.seq > 1) {
    const decision = await decideInPlaceContinuation(
      input.attempt.taskId,
      input.baseline,
      continuationReaders({ ...input, baseline: input.baseline })
    )
    input.audit.session = continuationSession(decision)
    if (decision.strategy === 'resumed_in_place') {
      await takeOverContinuationWorktree(
        decision,
        `axiom/attempt/${input.attempt.taskId}/${decision.fromSeq}`,
        input.attempt.branch
      )
      return { worktree: decision.worktree, continuation: decision }
    }
  }
  return { worktree: await input.create() }
}
