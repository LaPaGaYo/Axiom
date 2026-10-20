// The single Axiom classification feeds both the contract fence and durable receipts.
export const AXIOM_MUTATION_METHODS = [
  'axiom.attempt.submit',
  'axiom.attempt.ask',
  'axiom.message.answer',
  'axiom.message.resolve',
  'axiom.task.create',
  'axiom.attempt.inform',
  'axiom.attempt.request',
  'axiom.attempt.blocked',
  'axiom.attempt.handoff',
  'axiom.attempt.request-subtask',
  'axiom.mission.create',
  'axiom.mission.start',
  'axiom.mission.pause',
  'axiom.mission.resume',
  'axiom.mission.cancel',
  'axiom.goal.propose',
  'axiom.goal.activate',
  'axiom.plan.propose',
  'axiom.plan.approve',
  'axiom.plan.reject',
  'axiom.task.cancel',
  'axiom.artifact.put',
  'axiom.policy.update'
] as const

const mutations: ReadonlySet<string> = new Set(AXIOM_MUTATION_METHODS)

export function isAxiomMutation(method: string): boolean {
  return mutations.has(method)
}
