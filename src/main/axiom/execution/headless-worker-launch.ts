import { CodexAccountRequiredError } from '../../codex/codex-home-paths'
import { readCodexAccountHomeAllowlist } from '../../codex/codex-worker-launch-home'
import { headlessWorkerCombination, headlessClaudeCombination } from './worker-launch-combination'
import type { CreateWorktreeResult } from '../../../shared/worktree/create-types'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AuditEvent } from '../../../shared/axiom-contract/mission-objects'
import type { AdmittedAttempt } from '../scheduler/scheduler'
import type { AttemptLauncherDependencies } from './attempt-launcher'
import { buildHeadlessWorkerCommand } from './headless-worker-command'
import { prepareClaudeAttemptFiles, prepareHeadlessAttemptFiles } from './headless-attempt-files'
import { buildHeadlessTerminalCommand } from '../../runtime/rpc/methods/orchestration/worker/control-plane-worker-start'
import { ClaudeAccountRequiredError } from '../../claude-accounts/claude-account-required-error'
import { resolveHostAgentBaseEnvironment } from '../../runtime/structured-agent-shell-environment'
import { harnessEgressEnv } from './harness-egress-env'

export function createHeadlessWorkerLaunch(input: {
  deps: AttemptLauncherDependencies
  attempt: AdmittedAttempt
  spec: AgentSpec
  worktree: CreateWorktreeResult['worktree']
  render: string
  audit: Record<string, AuditEvent['after']>
  onMismatch: (dispatchId: string, reasons: string[]) => void
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
        provider: spec.provider,
        prompt: input.render.replaceAll('{{attemptId}}', dispatchId)
      })
      const settings = deps.runtime.requireStore().getSettings()
      const allowlist = readCodexAccountHomeAllowlist(settings)
      const claude = spec.provider === 'claude'
      const home = claude ? undefined : await deps.codexWorkerHome?.()
      const homePath = claude
        ? await deps.runtime.resolveClaudeHomeForWorkerLaunch?.()
        : home?.homePath
      if (claude ? !homePath : !home || home.kind !== 'account') {
        throw claude ? new ClaudeAccountRequiredError() : new CodexAccountRequiredError()
      }
      const { env: egressEnv, ...egress } = harnessEgressEnv({
        provider: claude ? 'claude' : 'codex',
        inherited: await (deps.resolveBaseEnvironment ?? resolveHostAgentBaseEnvironment)(settings)
      })
      const launch = buildHeadlessWorkerCommand({
        provider: spec.provider,
        model: spec.model,
        effort: spec.reasoning.effort,
        worktree: worktree.path,
        attemptDir,
        commandOverride: claude
          ? settings.agentCmdOverrides?.claude
          : settings.agentCmdOverrides?.codex,
        accountHomePath: homePath ?? undefined,
        egressEnv
      })
      if (!launch) {
        throw new Error('Headless builder unavailable')
      }
      let prepared:
        | Awaited<ReturnType<typeof headlessClaudeCombination>>
        | Awaited<ReturnType<typeof headlessWorkerCombination>>
      if (claude && homePath) {
        prepared = await headlessClaudeCombination({
          spec,
          homePath,
          allowlist,
          egress,
          command: launch.argv[0],
          files: await prepareClaudeAttemptFiles({
            directory: attemptDir,
            worktree: worktree.path,
            accountHomePath: homePath,
            allowlist
          })
        })
      } else {
        if (!home || home.kind !== 'account') {
          throw new CodexAccountRequiredError()
        }
        prepared = await headlessWorkerCombination(spec, home, allowlist, launch.argv[0], egress)
      }
      const { combination, reasons } = prepared
      if (
        !deps.store.bindAttemptDispatch(attempt.taskId, attempt.seq, dispatchId) &&
        deps.store.getAttemptBinding(attempt.taskId, attempt.seq)?.dispatchId !== dispatchId
      ) {
        throw new Error('Attempt dispatch binding changed')
      }
      Object.assign(input.audit, { argv: launch.argv, stdinPath: launch.stdinPath, combination })
      input.onPrepared(dispatchId, { ...input.audit, attemptDir })
      if (reasons.length) {
        input.onMismatch(dispatchId, reasons)
      }
      return buildHeadlessTerminalCommand({ ...launch, attemptDir })
    }
  }
}
