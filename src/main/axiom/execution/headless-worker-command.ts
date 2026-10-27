import path from 'node:path'
import { resolveCodexCommand } from '../../codex-cli/command'
import { CODEX_SESSION_OPTION_CATALOG } from '../../../shared/agent-session-option-catalog-claude-codex'
import { structuredAgentCommandToken } from '../../../shared/tui-agent-launch-command-override'

export function hasHeadlessWorkerBuilder(provider: string, platform = process.platform): boolean {
  return provider === 'codex' && (platform === 'darwin' || platform === 'linux')
}

export function buildHeadlessWorkerCommand(input: {
  provider: string
  model: string
  effort: string
  worktree: string
  attemptDir: string
  platform?: NodeJS.Platform
  commandOverride?: string
  accountHomePath?: string
}) {
  if (!hasHeadlessWorkerBuilder(input.provider, input.platform)) {
    return null
  }
  const override = input.commandOverride?.trim()
  const binary = override ? structuredAgentCommandToken(override) : resolveCodexCommand()
  if (!binary) {
    throw new Error('Headless Codex requires an executable command override.')
  }
  const catalog = CODEX_SESSION_OPTION_CATALOG
  const model =
    input.model === 'policy-default' ? [] : (catalog.modelApply.launchArgs?.(input.model) ?? [])
  const options =
    catalog.models.find((entry) => entry.id === input.model)?.options ?? catalog.unknownModelOptions
  const effort =
    options?.find((entry) => entry.id === 'effort')?.apply.launchArgs?.(input.effort) ?? []
  const env: Record<string, string> = input.accountHomePath
    ? { CODEX_HOME: input.accountHomePath }
    : {}
  return {
    argv: [
      binary,
      'exec',
      '--json',
      '--color',
      'never',
      '-s',
      'workspace-write',
      '-c',
      'sandbox_workspace_write.network_access=false',
      '-c',
      'approval_policy="never"',
      '-c',
      'features.hooks=false',
      '-c',
      'check_for_update_on_startup=false',
      '-c',
      'analytics.enabled=false',
      '-c',
      'feedback.enabled=false',
      '-c',
      'features.remote_plugin=false',
      '-C',
      input.worktree,
      '-o',
      path.join(input.attemptDir, 'last-message.md'),
      ...model,
      ...effort,
      '-'
    ],
    env,
    stdinPath: path.join(input.attemptDir, 'prompt.md')
  }
}
