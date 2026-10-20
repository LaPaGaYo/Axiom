import type { WorkerDispatchRow } from '../../runtime/orchestration/types'
import type { inspectWorkerTerminal } from '../../runtime/rpc/methods/orchestration/worker/worker-observation'
import type { AttemptBinding, RecoveryContext } from './attempt-recovery-effects'

export async function observeAgentExit(
  ctx: RecoveryContext,
  _binding: AttemptBinding,
  observation: Awaited<ReturnType<typeof inspectWorkerTerminal>>,
  worker: WorkerDispatchRow | null | undefined
): Promise<{ exited: false } | { exited: true; evidence: 'shell_foreground' }> {
  if (
    observation.status === 'live' &&
    observation.exact === true &&
    observation.terminal !== null &&
    worker?.state === 'ready' &&
    (await ctx.runtime.confirmTerminalShellForeground(observation.terminal.handle)) === true
  ) {
    return { exited: true, evidence: 'shell_foreground' }
  }
  return { exited: false }
}
