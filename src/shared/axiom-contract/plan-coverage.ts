import { z } from 'zod'
import type { TaskSpec } from './mission-objects'
import type { PlanProposalError } from './plan-proposal'
import type { PlanWarning } from './plan-warnings'

export const PlanCoverageSchema = z.object({
  criteria: z.array(
    z.object({
      index: z.number().int().nonnegative(),
      text: z.string(),
      taskIds: z.array(z.string())
    })
  ),
  uncovered: z.array(z.number().int().nonnegative())
})
export type PlanCoverage = z.infer<typeof PlanCoverageSchema>

export function planCoverage(
  { tasks }: { tasks: TaskSpec[] },
  goalCriteria: string[]
): PlanCoverage {
  const criteria = goalCriteria.map((text, index) => ({
    index,
    text,
    taskIds: [
      ...new Set(
        tasks.filter((task) => task.coversGoalCriteria?.includes(index)).map((task) => task.id)
      )
    ].sort()
  }))
  return {
    criteria,
    uncovered: criteria
      .filter((criterion) => !criterion.taskIds.length)
      .map((criterion) => criterion.index)
  }
}

export function coverageWarnings(
  plan: { tasks: TaskSpec[] },
  goalCriteria: string[]
): PlanWarning[] {
  const coverage = planCoverage(plan, goalCriteria)
  return coverage.uncovered.length
    ? [
        {
          code: 'incomplete_coverage',
          message: `Goal acceptance criteria are not covered by any Task: ${coverage.uncovered.map((index) => `#${index}`).join(', ')}`,
          taskIds: [],
          uncovered: coverage.criteria
            .filter((criterion) => !criterion.taskIds.length)
            .map(({ index, text }) => ({ index, text }))
        }
      ]
    : []
}

/** Goal-dependent validation belongs to commands that have resolved the active Goal. */
export function validateGoalCoverage(
  task: TaskSpec,
  total: number,
  path: (string | number)[]
): PlanProposalError[] {
  return (task.coversGoalCriteria ?? []).flatMap((index, position) =>
    index >= total
      ? [
          {
            code: 'coverage_index_out_of_range' as const,
            severity: 'error' as const,
            message: `Goal acceptance criterion index ${index} is out of range (${total} criteria).`,
            taskIds: [task.id],
            path: [...path, 'coversGoalCriteria', position]
          }
        ]
      : []
  )
}
