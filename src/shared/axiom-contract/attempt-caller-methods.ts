// These commands act as a Worker or Planner; other Axiom commands retain human/Control Plane identity.
export const AXIOM_ATTEMPT_CALLER_METHODS: readonly string[] = [
  'axiom.attempt.submit',
  'axiom.attempt.ask',
  'axiom.attempt.inform',
  'axiom.attempt.request',
  'axiom.attempt.blocked',
  'axiom.attempt.handoff',
  'axiom.attempt.request-subtask',
  'axiom.attempt.check',
  'axiom.plan.propose'
]

export function isAxiomAttemptCallerMethod(method: string): boolean {
  return AXIOM_ATTEMPT_CALLER_METHODS.includes(method)
}
