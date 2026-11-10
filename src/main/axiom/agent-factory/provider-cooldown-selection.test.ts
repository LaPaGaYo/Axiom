import { expect, it } from 'vitest'
import { RoutingPolicySchema } from '../../../shared/axiom-contract/mission-objects'
import { RulesEngine } from '../decision-engine/rules-engine'
import { PROVIDER_SELECTION_RULES, selectProvider } from './provider-selection'

const until = '2026-11-10T12:01:00.000Z'
const cooling = new Map([['codex', until]])
const engine = new RulesEngine(PROVIDER_SELECTION_RULES)
const routing = RoutingPolicySchema.parse({ roles: { worker: { provider: 'codex' } } })
const select = (installed = ['codex', 'claude'], role: 'worker' | 'planner' = 'worker') =>
  selectProvider(installed, routing, role, 'medium', engine, () => true, null, cooling)

it('filters a provider whose selected account is cooling', () => {
  expect(select().filtered).toContainEqual({ provider: 'codex', reason: 'account_cooldown' })
  expect(select().roleProviderUnavailable).toBe('account_cooldown')
})
it('routes new work to another eligible provider while an account cools', () => {
  expect(select()).toMatchObject({ chosen: 'claude', ranked: ['claude'] })
})
it('reports when the cooldown ends in the admission refusal', () => {
  expect(() => select(['codex'])).toThrowError(
    expect.objectContaining({
      code: 'no_eligible_provider',
      data: expect.objectContaining({
        accountCooldown: [{ provider: 'codex', until }],
        roleProviderUnavailable: 'account_cooldown'
      })
    })
  )
})
it('does not apply the cooldown to the planner role', () => {
  expect(select(['codex'], 'planner').chosen).toBe('codex')
})
it('retains the earlier filter reason for a disallowed cooling provider', () => {
  const selection = selectProvider(
    ['codex', 'claude'],
    {
      ...routing,
      disallowedProviders: ['codex']
    },
    'worker',
    'medium',
    engine,
    () => true,
    null,
    cooling
  )
  expect(selection.filtered).toContainEqual({ provider: 'codex', reason: 'disallowed' })
  expect(selection.filtered.at(-1)?.reason).not.toBe('account_cooldown')
})
