export const AXIOM_RPC_NAMESPACE = 'axiom'

export const AXIOM_RPC_METHOD_PREFIXES = [
  'axiom.mission.',
  'axiom.goal.',
  'axiom.plan.',
  'axiom.task.',
  'axiom.attempt.',
  'axiom.verification.',
  'axiom.integration.',
  'axiom.approval.',
  'axiom.decision.',
  'axiom.artifact.',
  'axiom.message.',
  'axiom.policy.'
] as const

export const AXIOM_CLI_COMMAND_NAMES = [
  'mission',
  'plan',
  'task',
  'approval',
  'attempt',
  'verification'
] as const
