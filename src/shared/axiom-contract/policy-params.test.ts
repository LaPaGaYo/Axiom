import { describe, expect, it } from 'vitest'
import { BudgetSchema, PolicySchema, RoutingPolicySchema } from './mission-objects'
import { PolicyShowParams, PolicyUpdateParams } from './policy-params'
import { policy } from './contract-fixtures.test-support'

describe('Mission routing policy', () => {
  it('validates verification rules on writes while legacy policy records remain readable', () => {
    expect(
      PolicyUpdateParams.parse({ missionId: 'm', patch: { verificationRules: {} } }).patch
    ).toMatchObject({ verificationRules: { timeBudgetMinutes: 30, setupCommands: [] } })
    for (const verificationRules of [{ commands: [] }, { setupCommands: 1 }]) {
      expect(
        PolicyUpdateParams.safeParse({ missionId: 'm', patch: { verificationRules } }).success
      ).toBe(false)
      expect(PolicySchema.safeParse({ ...policy, verificationRules }).success).toBe(true)
    }
  })
  it('validates strict show/update params and provider ids', () => {
    expect(PolicyUpdateParams.parse({ missionId: 'm', patch: {} }).patch).toEqual({})
    for (const readinessThreshold of ['VERIFIED', 'INTEGRATED']) {
      expect(
        PolicyUpdateParams.parse({ missionId: 'm', patch: { readinessThreshold } }).patch
      ).toEqual({ readinessThreshold })
    }
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
      providerConcurrency: {},
      models: {}
    })
    expect(BudgetSchema.parse({ contextTokens: 42 })).toEqual({ contextTokens: 42 })
    expect(BudgetSchema.safeParse({ contextTokens: 0 }).success).toBe(false)
  })
})
