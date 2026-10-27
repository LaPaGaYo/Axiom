import type { Settings } from '@anthropic-ai/claude-agent-sdk'
import path from 'node:path'

// D83: invocation pins, never written into the selected account home.
export const CLAUDE_LAUNCH_ENV = {
  CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  DISABLE_AUTOUPDATER: '1',
  DISABLE_TELEMETRY: '1',
  DISABLE_ERROR_REPORTING: '1',
  DISABLE_BUG_COMMAND: '1',
  CLAUDE_CODE_DISABLE_BUNDLED_SKILLS: '1'
}

// Workers cannot delegate, change worktrees, schedule work or use external-effect tools.
export const CLAUDE_EXTERNAL_TOOLS = [
  'WebFetch',
  'WebSearch',
  'Agent',
  'Task',
  'TaskOutput',
  'TaskStop',
  'SendMessage',
  'TeamCreate',
  'TeamDelete',
  'Computer',
  'EnterWorktree',
  'ExitWorktree',
  'CronCreate',
  'CronDelete'
]

export function claudeIsolationSettings() {
  return {
    syncClaudeAiSkills: false,
    syncClaudeAiPlugins: false,
    enabledPlugins: {}
  } satisfies Settings
}

export function claudeWorkerSettings(worktree: string, scratch: string) {
  return {
    ...claudeIsolationSettings(),
    permissions: {
      allow: [
        'Read',
        'Grep',
        'Glob',
        'LS',
        // File tools run outside the Bash sandbox. A leading // makes these rules absolute.
        ...['Edit', 'Write', 'MultiEdit', 'NotebookEdit'].flatMap((tool) =>
          [worktree, scratch].map((directory) => `${tool}(/${path.join(directory, '**')})`)
        ),
        'Bash'
      ],
      deny: [...CLAUDE_EXTERNAL_TOOLS]
    },
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      network: { allowedDomains: [], strictAllowlist: true, allowLocalBinding: false },
      filesystem: { allowWrite: [worktree, scratch] }
    }
  } satisfies Settings
}
