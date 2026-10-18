import { GLOBAL_FLAGS, type CommandSpec } from '../args'
export const AXIOM_ATTEMPT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['attempt', 'ask'],
    summary: 'Ask a blocking Worker question',
    usage:
      'axiom attempt ask --attempt <id> --dispatch-capability <token> --question <text> [--option <o>] [--timeout-ms <n>] [--resume <questionId>] [--retry-request <id>] --json',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'attempt',
      'from',
      'dispatch-capability',
      'question',
      'option',
      'timeout-ms',
      'resume',
      'retry-request'
    ],
    repeatableFlags: ['option']
  },
  ...['inform', 'request', 'blocked', 'handoff', 'request-subtask'].map((verb): CommandSpec => ({
    path: ['attempt', verb],
    summary: `Send a typed Worker ${verb} message`,
    usage: `axiom attempt ${verb} --attempt <id> --dispatch-capability <token> --summary <text> [--body <text> | --body-file <path>] [--artifact <id>] [--related-task <id>]${verb === 'request-subtask' ? ' --title <text> --objective <text> --allowed-path <path> --acceptance <text> --evidence <text> [--risk low|medium|high] [--depends-on <taskId>]' : ''} [--json]`,
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'attempt',
      'from',
      'dispatch-capability',
      'retry-request',
      'summary',
      'body',
      'body-file',
      'artifact',
      'related-task',
      ...(verb === 'request-subtask'
        ? ['title', 'objective', 'allowed-path', 'acceptance', 'evidence', 'risk', 'depends-on']
        : [])
    ],
    repeatableFlags: [
      'artifact',
      'related-task',
      ...(verb === 'request-subtask'
        ? ['allowed-path', 'acceptance', 'evidence', 'depends-on']
        : [])
    ],
    notes: [
      'Detailed content belongs in an Artifact. Summary and optional body are limited to 2,000 characters.'
    ]
  })),
  {
    path: ['attempt', 'check'],
    summary: 'Read the current Attempt mailbox',
    usage:
      'axiom attempt check --attempt <id> --dispatch-capability <token> [--wait] [--timeout-ms <n>] [--type <routing-type>] --json',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'attempt',
      'from',
      'dispatch-capability',
      'wait',
      'timeout-ms',
      'type'
    ]
  },
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
