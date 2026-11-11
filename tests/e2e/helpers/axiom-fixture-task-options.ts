import type { AcceptanceCriterion } from '../../../src/shared/axiom-contract/mission-objects'
import type { PlanProposal } from '../../../src/shared/axiom-contract/plan-proposal'

export type FixtureTaskOptions = {
  taskIds?: string[]
  acceptanceCriteria?: AcceptanceCriterion[]
  maxAttempts?: number
  taskRuntimeMinutes?: number
  extraAllowedPaths?: string[]
}

export function configureFixtureTasks(proposal: PlanProposal, options: FixtureTaskOptions) {
  const { taskIds } = options
  if (taskIds) {
    proposal.tasks = proposal.tasks.filter((task) => taskIds.includes(task.id))
    proposal.edges = proposal.edges.filter(
      (edge) => taskIds.includes(edge.fromTaskId) && taskIds.includes(edge.toTaskId)
    )
    const milestone = proposal.milestones[0]
    if (!milestone) {
      throw new Error('Missing fixture Milestone')
    }
    milestone.exitCriteria = taskIds.map((id) => `${id} integrated`)
  }
  for (const task of proposal.tasks) {
    if (options.acceptanceCriteria) {
      task.acceptanceCriteria = options.acceptanceCriteria
    }
    if (options.maxAttempts !== undefined) {
      task.retryPolicy.maxAttempts = options.maxAttempts
    }
    if (options.taskRuntimeMinutes !== undefined) {
      task.budget = { ...task.budget, maxRuntimeMinutes: options.taskRuntimeMinutes }
    }
    task.scope.allowedPaths.push(...(options.extraAllowedPaths ?? []))
  }
}
