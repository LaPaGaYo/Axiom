import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AXIOM_TASK_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['task', 'adjust'],
    summary: 'Adjust an idle Task scope or retry budget with a recorded rationale',
    usage:
      'axiom task adjust --task <id> --rationale <text> [--add-path <path>] [--max-attempts <n>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'task',
      'rationale',
      'add-path',
      'max-attempts',
      'retry-request'
    ],
    repeatableFlags: ['add-path'],
    examples: [
      'axiom task adjust --task task_123 --rationale "Reviewed scope" --add-path src/check.ts'
    ],
    notes: ['Human Task adjustments are accepted only through the Axiom desktop app.']
  },
  {
    path: ['task', 'create'],
    summary: 'Add a Task to the approved Mission plan',
    usage:
      'axiom task create --mission <id> --file <task.json> [--depends-on <taskId>] [--retry-request <id>] --json',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'file', 'depends-on', 'retry-request'],
    repeatableFlags: ['depends-on']
  },
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
