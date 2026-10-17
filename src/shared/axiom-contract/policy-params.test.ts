import { describe, expect, it } from 'vitest'
import { BudgetSchema, PolicySchema, RoutingPolicySchema } from './mission-objects'
import { PolicyShowParams, PolicyUpdateParams } from './policy-params'
import { policy } from './contract-fixtures.test-support'

describe('Mission routing policy', () => {
  it('validates strict show/update params and provider ids', () => {
    expect(PolicyShowParams.parse({ missionId: 'm' })).toEqual({ missionId: 'm' })
    expect(
      PolicyUpdateParams.parse({ missionId: 'm', patch: { routing: {} } }).patch.routing
    ).toEqual(RoutingPolicySchema.parse({}))
    for (const patch of [
      { unknown: true },
      { concurrencyLimit: 0 },
      { routing: { preferredProviders: ['unknown'] } },
      { routing: { highRiskTier: 'B' } }
    ]) {
      expect(PolicyUpdateParams.safeParse({ missionId: 'm', patch }).success).toBe(false)
    }
    // Budget presence must survive parsing so RPC can return approval_required, not invalid_argument.
    expect(PolicyUpdateParams.parse({ missionId: 'm', patch: { budget: null } }).patch).toEqual({
      budget: null
    })
  })
  it('defaults legacy routing and preserves contextTokens in the shared budget', () => {
    expect(PolicySchema.parse(policy).routing).toEqual({
      preferredProviders: [],
      disallowedProviders: [],
      highRiskTier: 'A',
      models: {}
    })
    expect(BudgetSchema.parse({ contextTokens: 42 })).toEqual({ contextTokens: 42 })
    expect(BudgetSchema.safeParse({ contextTokens: 0 }).success).toBe(false)
  })
})
