import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const AXIOM_VERIFICATION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['verification', 'resolve'],
    summary: 'Resolve a pending human verification review with a rationale',
    usage:
      'axiom verification resolve --run <id> --verdict PASS|FAIL --rationale <text> [--criterion <n>]... [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'run', 'verdict', 'rationale', 'criterion', 'retry-request'],
    repeatableFlags: ['criterion'],
    notes: [
      'Human verification decisions are accepted only through the Axiom desktop app. Criterion indices are zero-based.'
    ]
  },
  {
    path: ['verification', 'rerun'],
    summary: 'Verify the same Candidate again after correcting its criteria',
    usage:
      'axiom verification rerun --task <id> --rationale <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'task', 'rationale', 'retry-request'],
    notes: ['Human verification decisions are accepted only through the Axiom desktop app.']
  },
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
