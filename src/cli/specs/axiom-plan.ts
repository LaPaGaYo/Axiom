import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AXIOM_PLAN_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['plan', 'propose'],
    summary: 'Propose a validated Task graph',
    usage:
      'axiom plan propose --mission <id> --file <proposal.json> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'file', 'retry-request'],
    examples: ['axiom plan propose --mission mission_123 --file proposal.json']
  },
  {
    path: ['plan', 'approve'],
    summary: 'Approve a Plan revision',
    usage: 'axiom plan approve --plan <id> --resolver <name> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plan', 'resolver', 'retry-request'],
    examples: ['axiom plan approve --plan planrev_123 --resolver henry']
  },
  {
    path: ['plan', 'reject'],
    summary: 'Reject a Plan revision',
    usage:
      'axiom plan reject --plan <id> --resolver <name> --reason <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plan', 'resolver', 'reason', 'retry-request'],
    examples: ['axiom plan reject --plan planrev_123 --resolver henry --reason "Revise scope"'],
    destructive: true
  },
  {
    path: ['plan', 'list'],
    summary: 'List Plan revisions',
    usage: 'axiom plan list --mission <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission'],
    examples: ['axiom plan list --mission mission_123 --json']
  },
  {
    path: ['plan', 'show'],
    summary: 'Show a Plan revision',
    usage: 'axiom plan show --plan <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'plan'],
    examples: ['axiom plan show --plan planrev_123 --json']
  }
]
