import { expect, it } from 'vitest'
import { mission, policy } from '../../../../shared/axiom-contract/contract-fixtures.test-support'
import {
  DEFAULT_ROUTING_POLICY,
  PolicySchema,
  RoutingPolicySchema
} from '../../../../shared/axiom-contract/mission-objects'
import { PolicyUpdateParams } from '../../../../shared/axiom-contract/policy-params'
import {
  buildProvidersUpdate,
  listProviders,
  openProvidersDraft,
  roleProviderUnavailable,
  type ProviderEligibility
} from './providers-draft'
import { providerLabel, providerReasonGloss, providerSlotCopy } from './provider-copy'

const stored = PolicySchema.parse({
  ...policy,
  routing: {
    preferredProviders: ['codex', 'claude'],
    disallowedProviders: ['opencode', 'antigravity'],
    providerConcurrency: { codex: 2 },
    models: { codex: 'custom-model' },
    crossProvider: false,
    roles: { planner: { provider: 'codex' }, worker: { provider: 'claude', effort: 'high' } },
    requireCertified: true
  }
})
const yes = { eligible: true }
const no = { eligible: false, reason: 'disallowed' } as const
const answer: ProviderEligibility[] = [
  { provider: 'codex', planner: yes, worker: { low: yes, medium: yes, high: no } },
  { provider: 'claude', planner: no, worker: { low: yes, medium: yes, high: yes } }
]
const opened = openProvidersDraft(stored.routing)

it('opens a provider draft from the stored routing', () => {
  expect(opened).toEqual({
    planner: 'codex',
    worker: 'claude',
    disallowed: ['opencode', 'antigravity'],
    certified: true
  })
  expect(
    openProvidersDraft(RoutingPolicySchema.parse({ roles: { worker: { model: 'stored-model' } } }))
  ).toEqual({ planner: null, worker: null, disallowed: [], certified: false })
  expect(openProvidersDraft(DEFAULT_ROUTING_POLICY)).toEqual({
    planner: null,
    worker: null,
    disallowed: [],
    certified: false
  })
  expect(openProvidersDraft(null)).toEqual(openProvidersDraft(DEFAULT_ROUTING_POLICY))
  expect(opened.disallowed).not.toBe(stored.routing.disallowedProviders)
})

it('lists the answered providers first and then the stored ids', () => {
  const routing = RoutingPolicySchema.parse({
    roles: { planner: { provider: 'opencode' }, worker: { provider: 'codex' } },
    disallowedProviders: ['antigravity', 'opencode', 'codex']
  })
  expect(listProviders(routing, answer)).toEqual(['codex', 'claude', 'opencode', 'antigravity'])
  expect(listProviders(routing, null)).toEqual(['opencode', 'codex', 'antigravity'])
  expect(listProviders(routing, undefined)).toEqual(['opencode', 'codex', 'antigravity'])
  expect(listProviders(null, undefined)).toEqual([])
})

it('sends no routing when no provider field changed', () => {
  expect(buildProvidersUpdate(mission.id, stored, opened, opened)).toMatchObject({
    changed: [],
    params: null,
    error: null
  })
  const reordered = { ...opened, disallowed: ['antigravity', 'opencode'] }
  expect(buildProvidersUpdate(mission.id, stored, opened, reordered)).toMatchObject({
    changed: [],
    params: null
  })
})

it('carries every routing key it does not edit', () => {
  const update = buildProvidersUpdate(mission.id, stored, opened, { ...opened, worker: 'codex' })
  expect(update.changed).toEqual(['worker'])
  expect(update.params).toEqual({
    missionId: mission.id,
    patch: {
      routing: {
        ...stored.routing,
        roles: {
          ...stored.routing.roles,
          worker: { ...stored.routing.roles.worker, provider: 'codex' }
        }
      }
    }
  })
  expect(PolicyUpdateParams.parse(update.params)).toEqual(update.params)
})

it('keeps a stored role model and effort when the role provider changes', () => {
  const current = PolicySchema.parse({
    ...stored,
    routing: {
      ...stored.routing,
      roles: { planner: { provider: 'codex', model: 'stored-model', effort: 'xhigh' } }
    }
  })
  const initial = openProvidersDraft(current.routing)
  for (const provider of ['claude', null]) {
    const update = buildProvidersUpdate(mission.id, current, initial, {
      ...initial,
      planner: provider
    })
    expect(update.params?.patch.routing?.roles.planner).toEqual({
      ...(provider ? { provider } : {}),
      model: 'stored-model',
      effort: 'xhigh'
    })
  }
})

it('removes a role that is left empty', () => {
  const update = buildProvidersUpdate(mission.id, stored, opened, { ...opened, planner: null })
  expect(update.params?.patch.routing?.roles).toEqual({ worker: stored.routing.roles.worker })
})

it('writes the whole list of disallowed providers when the set changed', () => {
  const draft = { ...opened, disallowed: ['antigravity', 'codex', 'claude'] }
  const update = buildProvidersUpdate(mission.id, stored, opened, draft)
  expect(update.changed).toEqual(['disallowed'])
  expect(update.params?.patch).toEqual({
    routing: { ...stored.routing, disallowedProviders: draft.disallowed }
  })
})

it('builds on the routing stored now and not on the opened one', () => {
  const current = PolicySchema.parse({
    ...stored,
    routing: {
      ...stored.routing,
      models: { codex: 'new-model' },
      roles: {
        planner: { provider: 'claude', effort: 'low' },
        worker: { provider: 'claude', model: 'new-role-model' }
      }
    }
  })
  const update = buildProvidersUpdate(mission.id, current, opened, {
    ...opened,
    worker: 'codex',
    certified: false
  })
  expect(update.changed).toEqual(['worker', 'certified'])
  expect(update.params?.patch).toEqual({
    routing: {
      ...current.routing,
      requireCertified: false,
      roles: { ...current.routing.roles, worker: { provider: 'codex', model: 'new-role-model' } }
    }
  })
  expect(current.routing.roles.worker?.provider).toBe('claude')
  expect(stored.routing.requireCertified).toBe(true)
})

it('sends no routing while the policy cannot be read', () => {
  expect(
    buildProvidersUpdate(mission.id, null, opened, { ...opened, worker: 'codex' })
  ).toMatchObject({ params: null, error: null })
})

it('refuses a provider id the write schema does not know', () => {
  const draft = { ...opened, planner: 'unknown-provider' }
  const expected = PolicyUpdateParams.safeParse({
    missionId: mission.id,
    patch: {
      routing: {
        ...stored.routing,
        roles: { ...stored.routing.roles, planner: { provider: draft.planner } }
      }
    }
  })
  if (expected.success) {
    throw new Error('Expected schema rejection')
  }
  expect(buildProvidersUpdate(mission.id, stored, opened, draft)).toMatchObject({
    params: null,
    error: expected.error.issues[0]?.message
  })
})

it('marks a role provider that is not eligible in every slot', () => {
  expect(roleProviderUnavailable('planner', 'codex', answer)).toBe(false)
  expect(roleProviderUnavailable('planner', 'claude', answer)).toBe(true)
  expect(roleProviderUnavailable('worker', 'codex', answer)).toBe(true)
  expect(roleProviderUnavailable('worker', 'claude', answer)).toBe(false)
  for (const role of ['planner', 'worker'] as const) {
    expect(roleProviderUnavailable(role, null, answer)).toBe(false)
    expect(roleProviderUnavailable(role, 'opencode', answer)).toBe(false)
    expect(roleProviderUnavailable(role, 'codex', null)).toBe(false)
    expect(roleProviderUnavailable(role, 'codex', undefined)).toBe(false)
  }
})

it('glosses each of the six filter reasons in its own words', () => {
  const reasons = [
    'not_installed',
    'no_account',
    'not_certified',
    'disallowed',
    'tier_too_low',
    'account_cooldown'
  ] as const
  const glosses = [
    'Not installed on this computer. The policy does not change this.',
    'No account is selected. Choose one in Settings › Accounts.',
    'Not certified, or only provisional while this policy allows only certified combinations.',
    'Not allowed by this policy.',
    'Not certified for this role or risk level.',
    'The selected account is waiting after a usage limit. The policy does not change this.'
  ]
  expect(reasons.map(providerReasonGloss)).toEqual(glosses)
  expect(new Set(glosses).size).toBe(6)
  reasons.forEach((reason, index) =>
    expect(providerSlotCopy({ eligible: false, reason })).toEqual({
      value: reason,
      gloss: glosses[index]
    })
  )
  expect(providerSlotCopy(yes)).toEqual({ value: 'Yes' })
  expect(providerSlotCopy({ eligible: false })).toEqual({ value: 'No' })
  expect(
    ['codex', 'claude', 'opencode', 'antigravity', 'future-provider'].map(providerLabel)
  ).toEqual(['Codex', 'Claude', 'OpenCode', 'Antigravity', 'future-provider'])
})
