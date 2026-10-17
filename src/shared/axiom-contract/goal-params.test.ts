import { describe, expect, it } from 'vitest'
import { GoalActivateParams, GoalProposeParams, GoalShowParams } from './goal-params'
import { goal } from './contract-fixtures.test-support'

describe('axiom.goal params', () => {
  it.each([
    [
      'propose',
      GoalProposeParams,
      { missionId: 'm', goal },
      { missionId: 'm', goal: { ...goal, objective: '' } }
    ],
    [
      'activate',
      GoalActivateParams,
      { missionId: 'm', goalRevisionId: 'g' },
      { missionId: 'm', goalRevisionId: '' }
    ],
    ['show', GoalShowParams, { missionId: 'm', goalRevisionId: 'g' }, { goalRevisionId: '' }]
  ])('%s accepts valid and rejects invalid params', (_, schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true)
    expect(schema.safeParse(invalid).success).toBe(false)
  })
})
