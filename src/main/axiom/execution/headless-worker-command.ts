import path from 'node:path'
import { resolveClaudeCommand, resolveCodexCommand } from '../../codex-cli/command'
import {
  CLAUDE_SESSION_OPTION_CATALOG,
  CODEX_SESSION_OPTION_CATALOG
} from '../../../shared/agent-session-option-catalog-claude-codex'
import { structuredAgentCommandToken } from '../../../shared/tui-agent-launch-command-override'
import {
  CLAUDE_EXTERNAL_TOOLS,
  CLAUDE_LAUNCH_ENV,
  claudeManagedSettingsArg
} from './claude-launch-policy'

export function hasHeadlessWorkerBuilder(provider: string, platform = process.platform): boolean {
  return ['codex', 'claude'].includes(provider) && (platform === 'darwin' || platform === 'linux')
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
  const claude = input.provider === 'claude'
  const binary = override
    ? structuredAgentCommandToken(override)
    : claude
      ? resolveClaudeCommand()
      : resolveCodexCommand()
  if (!binary) {
    throw new Error(
      `Headless ${claude ? 'Claude' : 'Codex'} requires an executable command override.`
    )
  }
  const catalog = claude ? CLAUDE_SESSION_OPTION_CATALOG : CODEX_SESSION_OPTION_CATALOG
  const model =
    input.model === 'policy-default' ? [] : (catalog.modelApply.launchArgs?.(input.model) ?? [])
  const options =
    catalog.models.find((entry) => entry.id === input.model)?.options ?? catalog.unknownModelOptions
  const effort =
    options?.find((entry) => entry.id === 'effort')?.apply.launchArgs?.(input.effort) ?? []
  if (claude) {
    return {
      argv: [
        binary,
        '-p',
        '--output-format',
        'stream-json',
        '--verbose',
        '--permission-mode',
        'acceptEdits',
        '--permission-prompts',
        'none',
        '--setting-sources=',
        '--settings',
        path.join(input.attemptDir, 'claude-settings.json'),
        '--managed-settings',
        claudeManagedSettingsArg('worker'),
        '--strict-mcp-config',
        '--mcp-config',
        path.join(input.attemptDir, 'claude-mcp.json'),
        '--disallowedTools',
        CLAUDE_EXTERNAL_TOOLS.join(','),
        ...model,
        ...effort
      ],
      env: {
        ...CLAUDE_LAUNCH_ENV,
        ...(input.accountHomePath ? { CLAUDE_CONFIG_DIR: input.accountHomePath } : {})
      },
      stdinPath: path.join(input.attemptDir, 'prompt.md')
    }
  }
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
