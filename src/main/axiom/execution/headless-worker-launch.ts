import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import type { AttemptLauncherDependencies } from './attempt-launcher'
import { buildHeadlessWorkerCommand } from './headless-worker-command'
import { prepareHeadlessAttemptFiles } from './headless-attempt-files'
import { buildHeadlessTerminalCommand } from '../../runtime/rpc/methods/orchestration/worker/control-plane-worker-start'

export function createHeadlessWorkerLaunch(input: {
  deps: AttemptLauncherDependencies
  attempt: AdmittedAttempt
  spec: AgentSpec
  worktree: CreateWorktreeResult['worktree']
  render: string
  audit: Record<string, AuditEvent['after']>
  onPrepared: (dispatchId: string, after: Record<string, AuditEvent['after']>) => void
}) {
  return {
    prepare: async (dispatchId: string) => {
      const { deps, attempt, spec, worktree } = input
      const attemptDir = await prepareHeadlessAttemptFiles({
        attemptId: dispatchId,
        worktree: worktree.path,
        worktreeId: worktree.id,
        branch: attempt.branch,
        prompt: input.render.replaceAll('{{attemptId}}', dispatchId)
      })
      const launch = buildHeadlessWorkerCommand({
        provider: spec.provider,
        model: spec.model,
        effort: spec.reasoning.effort,
        worktree: worktree.path,
        attemptDir,
        commandOverride: deps.runtime.requireStore().getSettings().agentCmdOverrides?.codex
      })
      if (!launch) {
        throw new Error('Headless builder unavailable')
      }
      if (
        !deps.store.bindAttemptDispatch(attempt.taskId, attempt.seq, dispatchId) &&
        deps.store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId !== dispatchId
      ) {
        throw new Error('Attempt dispatch binding changed')
      }
      Object.assign(input.audit, { argv: launch.argv, stdinPath: launch.stdinPath })
      input.onPrepared(dispatchId, { ...input.audit, attemptDir })
      return buildHeadlessTerminalCommand({ ...launch, attemptDir })
    }
  }
}
