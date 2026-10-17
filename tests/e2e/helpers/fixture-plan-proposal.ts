import { z } from 'zod'
import {
  validatePlanProposal,
  type PlanProposal
} from '../../../src/shared/axiom-contract/plan-proposal'

// Parse only the frozen fixture fields needed for conversion; size/parallel hints
// are not authority for the Control Plane's dependency readiness calculation.
const DecompositionSchema = z.object({
  goalId: z.literal('goal-sprints-v1'),
  referenceOnly: z.literal(true),
  tasks: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      scope: z.array(z.string().min(1)),
      dependsOn: z.array(z.string().min(1)),
      acceptance: z.array(z.object({ command: z.string().min(1), must: z.string().min(1) })).min(1)
    })
  )
})

export function fixturePlanProposal(
  input: unknown,
  goalRevisionId: string,
  at = new Date().toISOString()
): PlanProposal {
  const { tasks } = DecompositionSchema.parse(input)
  const proposal: PlanProposal = {
    goalRevisionId,
    milestones: [{ id: 'm1', title: 'M1 exit', exitCriteria: ['all 12 Tasks integrated'] }],
    tasks: tasks.map((task) => ({
      id: task.id,
      title: task.title,
      objective: task.title,
      scope: { allowedPaths: task.scope },
      acceptanceCriteria: task.acceptance.map((entry) => entry.must),
      requiredEvidence: [...new Set(task.acceptance.map((entry) => entry.command))],
      risk: 'low',
      retryPolicy: { maxAttempts: 2 },
      kind: 'task',
      milestoneId: 'm1'
    })),
    edges: tasks.flatMap((task) =>
      task.dependsOn.map((dep) => ({
        fromTaskId: dep,
        toTaskId: task.id,
        readinessThreshold: 'INTEGRATED'
      }))
    ),
    risks: [],
    provenance: { kind: 'user', actor: 'e2e', at }
  }
  const validation = validatePlanProposal(proposal)
  if (!validation.ok) {
    throw new Error(`Invalid fixture PlanProposal: ${JSON.stringify(validation.errors)}`)
  }
  return proposal
}
