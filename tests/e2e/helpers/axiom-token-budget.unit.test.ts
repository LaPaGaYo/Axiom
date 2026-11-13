import { expect, it } from 'vitest'
import { makeProposal } from '../../../src/shared/axiom-contract/contract-fixtures.test-support'
import { PlanProposalSchema } from '../../../src/shared/axiom-contract/plan-proposal'
import { configureFixtureTasks } from './axiom-fixture-task-options'

it('adds a Task token cap only when the fixture opts in and keeps other budgets', () => {
  const proposal = PlanProposalSchema.parse(makeProposal())
  for (const task of proposal.tasks) {
    task.budget = { maxRuntimeMinutes: 9 }
  }
  configureFixtureTasks(proposal, { taskIds: ['T01'], taskMaxTokens: 1000 })
  expect(PlanProposalSchema.parse(proposal).tasks[0]?.budget).toEqual({
    maxRuntimeMinutes: 9,
    maxTokens: 1000
  })
})
