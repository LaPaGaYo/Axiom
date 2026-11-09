import { expect, it } from 'vitest'
import { makeProposal } from './contract-fixtures.test-support'
import { planCoverage, coverageWarnings, validateGoalCoverage } from './plan-coverage'
import { TaskSpecSchema } from './mission-objects'
import { PlanWarningSchema } from './plan-warnings'

it('projects sorted unique Task ids for every Goal criterion without mutating input', () => {
  const tasks = makeProposal().tasks.slice(0, 3)
  tasks[0].coversGoalCriteria = [0, 0, 2]
  tasks[1].coversGoalCriteria = [0]
  const before = JSON.stringify(tasks)
  expect(planCoverage({ tasks: tasks.toReversed() }, ['one', 'two', 'three'])).toEqual({
    criteria: [
      { index: 0, text: 'one', taskIds: ['T01', 'T02'] },
      { index: 1, text: 'two', taskIds: [] },
      { index: 2, text: 'three', taskIds: ['T01'] }
    ],
    uncovered: [1]
  })
  expect(JSON.stringify(tasks)).toBe(before)
})

it('returns no warning for fully covered or empty Goals and one for all missing criteria', () => {
  const tasks = makeProposal().tasks
  expect(planCoverage({ tasks }, [])).toEqual({ criteria: [], uncovered: [] })
  expect(coverageWarnings({ tasks }, [])).toEqual([])
  expect(coverageWarnings({ tasks }, ['one', 'two'])).toEqual([
    {
      code: 'incomplete_coverage',
      message: 'Goal acceptance criteria are not covered by any Task: #0, #1',
      taskIds: [],
      uncovered: [
        { index: 0, text: 'one' },
        { index: 1, text: 'two' }
      ]
    }
  ])
  tasks[0].coversGoalCriteria = [0, 1]
  expect(coverageWarnings({ tasks }, ['one', 'two'])).toEqual([])
})

it('checks Goal indexes only when the caller supplies the active Goal', () => {
  const task = { ...makeProposal().tasks[0], coversGoalCriteria: [0, 2] }
  expect(validateGoalCoverage(task, 2, ['tasks', 0])).toEqual([
    {
      code: 'coverage_index_out_of_range',
      severity: 'error',
      message: 'Goal acceptance criterion index 2 is out of range (2 criteria).',
      taskIds: ['T01'],
      path: ['tasks', 0, 'coversGoalCriteria', 1]
    }
  ])
  expect(validateGoalCoverage(task, 3, ['task'])).toEqual([])
  expect(validateGoalCoverage({ ...task, coversGoalCriteria: [0] }, 0, ['task'])).toHaveLength(1)
})

it('keeps coverage optional and bounds the additive contract', () => {
  const task = makeProposal().tasks[0]
  expect(TaskSpecSchema.parse(task)).not.toHaveProperty('coversGoalCriteria')
  for (const coversGoalCriteria of [[-1], [0.1], Array(51).fill(0)]) {
    expect(TaskSpecSchema.safeParse({ ...task, coversGoalCriteria }).success).toBe(false)
  }
})

it('requires code-specific warning fields and rejects unknown keys and wrong Task counts', () => {
  const warning = coverageWarnings({ tasks: [] }, ['one'])[0]
  expect(PlanWarningSchema.safeParse(warning).success).toBe(true)
  expect(PlanWarningSchema.safeParse({ ...warning, extra: true }).success).toBe(false)
  expect(PlanWarningSchema.safeParse({ ...warning, taskIds: ['T01'] }).success).toBe(false)
  expect(
    PlanWarningSchema.safeParse({
      code: 'scope_overlap',
      message: 'Overlap',
      taskIds: ['T01'],
      paths: []
    }).success
  ).toBe(false)
  expect(
    PlanWarningSchema.safeParse({
      code: 'insufficient_parallel_roots',
      message: 'Roots',
      taskIds: [],
      found: 0
    }).success
  ).toBe(false)
})
