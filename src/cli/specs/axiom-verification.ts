import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const AXIOM_VERIFICATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['verification', 'show'],
    summary: 'Show a VerificationRun and its Candidate identity',
    usage: 'axiom verification show --run <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run']
  },
  {
    path: ['verification', 'list'],
    summary: 'List VerificationRuns for a Mission',
    usage:
      'axiom verification list --mission <id> [--task <id>] [--candidate <id>] [--status <status>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'task', 'candidate', 'status']
  }
]
