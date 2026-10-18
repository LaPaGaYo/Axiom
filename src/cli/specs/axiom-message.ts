import { GLOBAL_FLAGS, type CommandSpec } from '../args'

export const AXIOM_MESSAGE_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['message', 'list'],
    summary: 'List Mission messages and pending items',
    usage: 'axiom message list --mission <id> [--type <T>] [--pending] --json',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'type', 'pending']
  },
  {
    path: ['message', 'answer'],
    summary: 'Answer a pending Worker question',
    usage:
      'axiom message answer --mission <id> --question <messageId> --body <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'question', 'body', 'retry-request']
  },
  {
    path: ['message', 'resolve'],
    summary: 'Accept or reject a pending subtask request',
    usage:
      'axiom message resolve --mission <id> --message <id> --accept|--reject --rationale <text> [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mission',
      'message',
      'accept',
      'reject',
      'rationale',
      'retry-request'
    ]
  }
]
