import type { HandlerGroup } from './handler-group-manifest'

// Why split out: the Axiom command groups change as a unit, so keeping them here
// keeps handler-group-manifest.ts within its line limit.
export const AXIOM_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'axiom-verification',
    keys: ['verification show', 'verification list'],
    load: async () => (await import('./handlers/axiom/verification.js')).AXIOM_VERIFICATION_HANDLERS
  },
  {
    name: 'axiom-message',
    keys: ['message list', 'message answer', 'message resolve'],
    load: async () => (await import('./handlers/axiom/message.js')).AXIOM_MESSAGE_HANDLERS
  },
  {
    name: 'axiom-mission',
    keys: [
      'mission create',
      'mission show',
      'mission list',
      'mission start',
      'mission plan',
      'mission pause',
      'mission resume',
      'mission cancel',
      'mission goal propose',
      'mission goal activate',
      'mission goal show',
      'mission artifact put',
      'mission artifact read',
      'mission artifact list',
      'mission policy show',
      'mission policy update'
    ],
    load: async () => (await import('./handlers/axiom/mission.js')).AXIOM_MISSION_HANDLERS
  },
  {
    name: 'axiom-plan',
    keys: ['plan propose', 'plan approve', 'plan reject', 'plan list', 'plan show'],
    load: async () => (await import('./handlers/axiom/plan.js')).AXIOM_PLAN_HANDLERS
  },
  {
    name: 'axiom-attempt',
    keys: [
      'attempt submit',
      'attempt ask',
      'attempt show',
      'attempt list',
      'attempt inform',
      'attempt request',
      'attempt blocked',
      'attempt handoff',
      'attempt request-subtask',
      'attempt check'
    ],
    load: async () => (await import('./handlers/axiom/attempt.js')).AXIOM_ATTEMPT_HANDLERS
  },
  {
    name: 'axiom-task',
    keys: ['task create', 'task list', 'task show', 'task cancel'],
    load: async () => (await import('./handlers/axiom/task.js')).AXIOM_TASK_HANDLERS
  }
]
