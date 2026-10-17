import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AXIOM_TASK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['task', 'list'],
    summary: 'List Tasks by authoritative stage',
    usage: 'axiom task list --mission <id> [--stage <stage>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'stage'],
    examples: ['axiom task list --mission mission_123 --stage READY']
  },
  {
    path: ['task', 'show'],
    summary: 'Show a Task',
    usage: 'axiom task show --task <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task'],
    examples: ['axiom task show --task task_123 --json']
  },
  {
    path: ['task', 'cancel'],
    summary: 'Cancel a Task with a recorded rationale',
    usage: 'axiom task cancel --task <id> --rationale <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'rationale', 'retry-request'],
    examples: ['axiom task cancel --task task_123 --rationale "Superseded requirement"'],
    destructive: true
  }
]
