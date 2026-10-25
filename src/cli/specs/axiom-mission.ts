import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const AXIOM_MISSION_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['mission', 'plan'],
    summary: 'Launch a read-only Planner for the Mission goal',
    usage: 'axiom mission plan --mission <id> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'retry-request'],
    examples: ['axiom mission plan --mission mission_123 --json']
  },
  {
    path: ['mission', 'policy', 'show'],
    summary: 'Show Mission policy',
    usage: 'axiom mission policy show --mission <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission'],
    examples: ['axiom mission policy show --mission mission_123 --json']
  },
  {
    path: ['mission', 'policy', 'update'],
    summary:
      'Update Mission provider routing, concurrency or verification rules (JSON file replaces rules)',
    usage:
      'axiom mission policy update --mission <id> [--routing-file <json>] [--verification-rules-file <json>] [--concurrency <n>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mission',
      'routing-file',
      'verification-rules-file',
      'concurrency',
      'retry-request'
    ],
    examples: [
      'axiom mission policy update --mission mission_123 --routing-file routing.json --concurrency 3 --json'
    ],
    notes: [
      'Routing replaces the routing object; omitted fields use defaults. Budget changes require Approval and are unavailable until M4.'
    ]
  },
  {
    path: ['mission', 'create'],
    summary: 'Create a Mission for a repository',
    usage:
      'axiom mission create --repo <selector> --target-branch <branch> --goal-file <path.md|json> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'target-branch', 'goal-file', 'retry-request'],
    examples: [
      'axiom mission create --repo path:/src/repository --target-branch main --goal-file GOAL.md --json'
    ]
  },
  {
    path: ['mission', 'show'],
    summary: 'Show a Mission',
    usage: 'axiom mission show --mission <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission'],
    examples: ['axiom mission show --mission mission_123 --json']
  },
  {
    path: ['mission', 'list'],
    summary: 'List Missions',
    usage: 'axiom mission list [--repo <selector>] [--status <status>] [--cursor <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'repo', 'status', 'cursor'],
    examples: ['axiom mission list --status EXECUTING --json']
  },
  {
    path: ['mission', 'start'],
    summary: 'Start execution of an approved Mission',
    usage: 'axiom mission start --mission <id> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'retry-request'],
    examples: ['axiom mission start --mission mission_123']
  },
  {
    path: ['mission', 'pause'],
    summary: 'Pause a Mission',
    usage: 'axiom mission pause --mission <id> --reason <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'reason', 'retry-request'],
    examples: ['axiom mission pause --mission mission_123 --reason "Review needed"']
  },
  {
    path: ['mission', 'resume'],
    summary: 'Resume a Mission',
    usage: 'axiom mission resume --mission <id> --reason <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'reason', 'retry-request'],
    examples: ['axiom mission resume --mission mission_123 --reason "Review finished"']
  },
  {
    path: ['mission', 'cancel'],
    summary: 'Cancel a Mission',
    usage: 'axiom mission cancel --mission <id> --reason <text> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'reason', 'retry-request'],
    examples: ['axiom mission cancel --mission mission_123 --reason "Goal withdrawn"'],
    destructive: true
  },
  {
    path: ['mission', 'goal', 'propose'],
    summary: 'Propose a Goal revision',
    usage:
      'axiom mission goal propose --mission <id> --goal-file <path.md|json> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'goal-file', 'retry-request'],
    examples: ['axiom mission goal propose --mission mission_123 --goal-file revised-goal.json']
  },
  {
    path: ['mission', 'goal', 'activate'],
    summary: 'Activate a proposed Goal revision',
    usage: 'axiom mission goal activate --mission <id> --goal <id> [--retry-request <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'goal', 'retry-request'],
    examples: ['axiom mission goal activate --mission mission_123 --goal goalrev_456'],
    notes: [
      'Activation is available during ANALYZING or EXECUTING. An executing Mission enters REPLANNING; approval of a replacement plan is not available yet.'
    ]
  },
  {
    path: ['mission', 'goal', 'show'],
    summary: 'Show a Goal revision',
    usage: 'axiom mission goal show --mission <id> --goal <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'goal'],
    examples: ['axiom mission goal show --mission mission_123 --goal goalrev_456 --json']
  },
  {
    path: ['mission', 'artifact', 'put'],
    summary: 'Store content-addressed Mission evidence',
    usage:
      'axiom mission artifact put --mission <id> --kind <kind> --file <path> [--attempt <id>] [--related <ids>] [--media-type <type>] [--created-by <actor>] [--retry-request <id>] [--json]',
    allowedFlags: [
      ...GLOBAL_FLAGS,
      'mission',
      'kind',
      'file',
      'related',
      'media-type',
      'created-by',
      'attempt',
      'retry-request'
    ],
    examples: [
      'axiom mission artifact put --mission mission_123 --kind handoff --file handoff.md --related task_123',
      'axiom mission artifact put --attempt dispatch_123 --mission mission_123 --kind worker_report --file REPORT.md'
    ],
    notes: ['Related ids are comma-separated. Maximum file size is 8 MiB.']
  },
  {
    path: ['mission', 'artifact', 'read'],
    summary: 'Read and verify a Mission artifact',
    usage: 'axiom mission artifact read --artifact <id> [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'artifact'],
    examples: ['axiom mission artifact read --artifact art_123 --json'],
    notes: ['Text output is UTF-8; JSON preserves binary content as contentBase64.']
  },
  {
    path: ['mission', 'artifact', 'list'],
    summary: 'List Mission evidence',
    usage: 'axiom mission artifact list --mission <id> [--kind <kind>] [--related <id>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'mission', 'kind', 'related'],
    examples: ['axiom mission artifact list --mission mission_123 --kind handoff --json']
  }
]
