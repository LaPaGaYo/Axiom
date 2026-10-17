import { GLOBAL_FLAGS, type CommandSpec } from '../args'
export const AXIOM_ATTEMPT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['attempt', 'show'],
    summary: 'Show an Attempt and execution evidence',
    usage: 'axiom attempt show --attempt <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'attempt'],
    examples: ['axiom attempt show --attempt dispatch_123 --json']
  },
  {
    path: ['attempt', 'list'],
    summary: 'List Mission Attempts',
    usage: 'axiom attempt list --mission <id> [--task <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'task'],
    examples: ['axiom attempt list --mission mission_123 --json']
  }
]
