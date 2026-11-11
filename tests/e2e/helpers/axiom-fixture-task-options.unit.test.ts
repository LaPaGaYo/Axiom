import { expect, it } from 'vitest'
import { makeProposal } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import { PlanProposalSchema } from '../../../src/shared/axiom-contract/plan-proposal'
import { configureFixtureTasks } from './axiom-fixture-task-options'

it('gives selected fixture Tasks a runtime budget while retaining their other limits', () => {
  const proposal = PlanProposalSchema.parse(makeProposal())
  for (const task of proposal.tasks) {
    task.budget = { maxTokens: 1000 }
  }
  configureFixtureTasks(proposal, {
    taskIds: ['T01', 'T02', 'T04'],
    maxAttempts: 2,
    taskRuntimeMinutes: 0.05,
    extraAllowedPaths: ['src/services/budget-partial.ts']
  })
  const parsed = PlanProposalSchema.parse(proposal)
  expect(parsed.tasks.map(({ id }) => id)).toEqual(['T01', 'T02', 'T04'])
  for (const task of parsed.tasks) {
    expect(task.budget).toEqual({ maxRuntimeMinutes: 0.05, maxTokens: 1000 })
    expect(task.retryPolicy.maxAttempts).toBe(2)
    expect(task.scope.allowedPaths).toContain('src/services/budget-partial.ts')
  }
  expect(parsed.edges).toEqual([
    { fromTaskId: 'T01', toTaskId: 'T04', readinessThreshold: 'INTEGRATED' },
    { fromTaskId: 'T02', toTaskId: 'T04', readinessThreshold: 'INTEGRATED' }
  ])
  expect(parsed.milestones[0]?.exitCriteria).toEqual([
    'T01 integrated',
    'T02 integrated',
    'T04 integrated'
  ])
})

it('preserves fixture defaults when no Task options are supplied', () => {
  const proposal = PlanProposalSchema.parse(makeProposal())
  const original = structuredClone(proposal)
  configureFixtureTasks(proposal, {})
  expect(proposal).toEqual(original)
})
