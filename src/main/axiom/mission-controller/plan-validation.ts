import {
  PlanProposalSchema,
  validatePlanProposal,
  type PlanProposalError
} from '../../../shared/axiom-contract/plan-proposal'
import type { TaskSpec } from '../../../shared/axiom-contract/mission-objects'
import type { VerificationRules } from '../../../shared/axiom-contract/verification-rules'
import {
  evidenceCommandMessage,
  validateAcceptanceCommands
} from '../../../shared/axiom-contract/evidence-commands'
import { resolveAcceptance } from '../../../shared/axiom-contract/acceptance'
import { redactContext } from '../context-builder/redaction'
import { MissionControllerError } from './controller-context'

export function validatedProposal(input: unknown, persisted = false) {
  const validation = validatePlanProposal(input, { persisted })
  if (!validation.ok) {
    throw new MissionControllerError('plan_invalid', { errors: validation.errors })
  }
  return {
    proposal: PlanProposalSchema.parse(input),
    order: validation.order,
    warnings: validation.warnings
  }
}

export function validateTaskCommands(
  task: TaskSpec,
  rules: VerificationRules,
  path: (string | number)[]
): PlanProposalError[] {
  const criteria = resolveAcceptance(task)
  return validateAcceptanceCommands(criteria, rules).map((issue) => ({
    code: 'evidence_command_invalid',
    severity: 'error',
    message: redactContext(evidenceCommandMessage(issue, issue.command)).content,
    path: [...path, 'acceptanceCriteria', issue.index, 'check', 'command'],
    taskIds: [task.id]
  }))
}
