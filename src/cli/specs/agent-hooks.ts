import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AGENT_HOOK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['agent', 'hooks', 'prepare-codex'],
    summary: "Prepare a WSL pane's Axiom-managed Codex home before a shell launch",
    usage: 'axiom agent hooks prepare-codex',
    allowedFlags: [...GLOBAL_FLAGS]
  },
  {
    path: ['agent', 'hooks', 'status'],
    summary: 'Show whether Axiom-managed agent status hooks are enabled',
    usage: 'axiom agent hooks status [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['axiom agent hooks status', 'axiom agent hooks status --json']
  },
  {
    path: ['agent', 'hooks', 'off'],
    summary: 'Disable Axiom-managed agent status hooks and remove local hook entries',
    usage: 'axiom agent hooks off [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['axiom agent hooks off']
  },
  {
    path: ['agent', 'hooks', 'on'],
    summary: 'Enable Axiom-managed agent status hooks',
    usage: 'axiom agent hooks on [--json]',
    allowedFlags: [...GLOBAL_FLAGS],
    examples: ['axiom agent hooks on']
  }
]
