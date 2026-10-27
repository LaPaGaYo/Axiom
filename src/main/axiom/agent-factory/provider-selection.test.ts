import { describe, expect, it, vi } from 'vitest'
import {
  RoutingPolicySchema,
  TuiAgentIdSchema
} from '../../../shared/axiom-contract/mission-objects'
import { RulesEngine } from '../decision-engine/rules-engine'
import { AgentFactoryError, PROVIDER_SELECTION_RULES, selectProvider } from './provider-selection'
import { CERTIFIED_PROVIDER_COMBOS, certifiedCombo } from './certified-providers'

const routing = RoutingPolicySchema.parse({})
const makeEngine = () => new RulesEngine(PROVIDER_SELECTION_RULES)

describe('certified provider selection', () => {
  it('lists exactly four valid V1 execution identities; only codex is certified (D57)', () => {
    expect(CERTIFIED_PROVIDER_COMBOS.map((combo) => combo.provider)).toEqual([
      'claude',
      'codex',
      'antigravity',
      'opencode'
    ])
    for (const combo of CERTIFIED_PROVIDER_COMBOS) {
      expect(TuiAgentIdSchema.safeParse(combo.provider).success).toBe(true)
      // Why: a combo turns certified only with host evidence recorded under D57 (never by default).
      if (combo.provider === 'codex') {
        expect(combo.status).toBe('certified')
        expect(combo.evidence).toBe('.axiom-work/verifications/M3-08-smoke-real-codex.md')
      } else {
        expect(combo.status).toBe('provisional')
        expect(combo.evidence).toBeUndefined()
      }
      expect(combo.endpointProfile).toBe('subscription')
      expect(combo.model).toBe(combo.provider === 'opencode' ? 'harness-default' : 'launch-arg')
      expect(certifiedCombo(combo.provider)).toBe(combo)
    }
    expect(certifiedCombo('gemini')).toBeUndefined()
    expect(certifiedCombo('continue')).toBeUndefined()
    expect(certifiedCombo('unknown')).toBeUndefined()
  })

  it.each([{ preferred: [] }, { preferred: ['gemini' as const] }])(
    'never ranks uncertified harnesses with preferences $preferred',
    ({ preferred }) => {
      const engine = makeEngine()
      const rank = vi.spyOn(engine, 'rank')
      const selection = selectProvider(
        ['claude', 'gemini', 'continue'],
        { ...routing, preferredProviders: preferred },
        'worker',
        'low',
        engine
      )
      expect(selection.chosen).toBe('claude')
      expect(selection.ranked).toEqual(['claude'])
      expect(selection.filtered).toEqual([
        { provider: 'codex', reason: 'not_installed' },
        { provider: 'opencode', reason: 'not_installed' },
        { provider: 'antigravity', reason: 'not_installed' },
        { provider: 'gemini', reason: 'not_certified' },
        { provider: 'continue', reason: 'not_certified' }
      ])
      expect(rank).toHaveBeenCalledWith({
        candidates: ['claude'],
        context: expect.objectContaining({
          preferredProviders: preferred,
          filtered: selection.filtered
        })
      })
    }
  )

  it.each([
    ['antigravity', 'worker', 'low', true],
    ['antigravity', 'worker', 'medium', true],
    ['antigravity', 'worker', 'high', false],
    ['antigravity', 'planner', 'low', false],
    ['antigravity', 'planner', 'high', false],
    ['opencode', 'worker', 'low', true],
    ['opencode', 'worker', 'medium', false],
    ['opencode', 'worker', 'high', false],
    ['opencode', 'planner', 'low', false],
    ['opencode', 'planner', 'high', false]
  ] as const)('bounds %s for %s at %s risk (eligible: %s)', (provider, role, risk, eligible) => {
    const selection = selectProvider(
      ['claude', provider],
      { ...routing, preferredProviders: [provider] },
      role,
      risk,
      makeEngine()
    )
    expect(selection.ranked).toEqual(eligible ? [provider, 'claude'] : ['claude'])
    expect(selection.filtered.filter((entry) => entry.provider === provider)).toEqual(
      eligible ? [] : [{ provider, reason: 'tier_too_low' }]
    )
  })

  it('records only missing matrix providers when no harness is installed', () => {
    const engine = makeEngine()
    const rank = vi.spyOn(engine, 'rank')
    expect(() => selectProvider([], routing, 'worker', 'low', engine)).toThrow(
      expect.objectContaining({
        code: 'no_eligible_provider',
        data: {
          installed: [],
          filtered: [
            { provider: 'claude', reason: 'not_installed' },
            { provider: 'codex', reason: 'not_installed' },
            { provider: 'opencode', reason: 'not_installed' },
            { provider: 'antigravity', reason: 'not_installed' }
          ]
        }
      })
    )
    expect(rank).not.toHaveBeenCalled()
  })

  it('fails without ranking when only uncertified harnesses are installed', () => {
    const engine = makeEngine()
    const rank = vi.spyOn(engine, 'rank')
    expect(() =>
      selectProvider(
        ['gemini', 'continue'],
        { ...routing, preferredProviders: ['gemini'] },
        'worker',
        'low',
        engine
      )
    ).toThrow(expect.objectContaining({ code: 'no_eligible_provider' }))
    expect(rank).not.toHaveBeenCalled()
  })

  it('orders first-match filter reasons before config order', () => {
    const selection = selectProvider(
      ['opencode', 'gemini', 'continue', 'codex', 'antigravity'],
      {
        ...routing,
        disallowedProviders: ['claude', 'gemini', 'continue', 'opencode']
      },
      'worker',
      'high',
      makeEngine()
    )
    expect(selection.filtered).toEqual([
      { provider: 'claude', reason: 'not_installed' },
      { provider: 'gemini', reason: 'not_certified' },
      { provider: 'continue', reason: 'not_certified' },
      { provider: 'opencode', reason: 'disallowed' },
      { provider: 'antigravity', reason: 'tier_too_low' }
    ])
    expect(selection.ranked).toEqual(['codex'])
  })

  it('preserves config order for eligible tier-B ties', () => {
    expect(
      selectProvider(['antigravity', 'opencode'], routing, 'worker', 'low', makeEngine()).ranked
    ).toEqual(['opencode', 'antigravity'])
  })

  it('rejects an advisory engine that adds an uncertified harness', () => {
    const engine = makeEngine()
    vi.spyOn(engine, 'rank').mockReturnValue({
      ranked: ['gemini', 'codex'],
      rationale: 'uncertified advice',
      confidence: 1,
      engine: 'rules'
    })
    expect(() =>
      selectProvider(['claude', 'codex', 'gemini'], routing, 'worker', 'low', engine)
    ).toThrow(new AgentFactoryError('invalid_argument', { reason: 'invalid_provider_ranking' }))
  })
})

it.each(['planner', 'worker'] as const)(
  'filters no_account for %s after installation and before certification',
  (role) => {
    const selection = selectProvider(
      ['claude', 'codex', 'gemini'],
      routing,
      role,
      'high',
      makeEngine(),
      (provider) => provider !== 'codex'
    )
    expect(selection.chosen).toBe('claude')
    expect(selection.filtered).toEqual([
      { provider: 'opencode', reason: 'not_installed' },
      { provider: 'antigravity', reason: 'not_installed' },
      { provider: 'codex', reason: 'no_account' },
      { provider: 'gemini', reason: 'not_certified' }
    ])
    expect(
      selectProvider(
        ['claude'],
        routing,
        role,
        'high',
        makeEngine(),
        (provider) => provider !== 'codex'
      ).filtered
    ).toContainEqual({ provider: 'codex', reason: 'not_installed' })
  }
)

describe('role and cross-provider routing', () => {
  it.each([
    { available: ['codex'], reason: 'not_installed' },
    { available: ['codex', 'claude-agent-teams'], reason: 'not_certified' }
  ])('refuses a role launch mode with $reason precedence', ({ available, reason }) => {
    const selection = selectProvider(
      available,
      { ...routing, roles: { worker: { provider: 'claude-agent-teams' } } },
      'worker',
      'high',
      makeEngine()
    )
    expect(selection.chosen).toBe('codex')
    expect(selection.installed).toEqual(['codex'])
    expect(selection.roleProviderUnavailable).toBe(reason)
    expect(selection.filtered).toContainEqual({ provider: 'claude-agent-teams', reason })
  })

  it.each(['planner', 'worker'] as const)('prefers the explicit %s provider', (role) => {
    const selection = selectProvider(
      ['claude', 'codex'],
      { ...routing, roles: { [role]: { provider: 'codex' } }, preferredProviders: ['claude'] },
      role,
      'high',
      makeEngine()
    )
    expect(selection.ranked).toEqual(['codex', 'claude'])
    expect(selection.rationale).toContain('role provider')
  })

  it('prefers a different Worker provider over preferredProviders', () => {
    const selection = selectProvider(
      ['claude', 'codex'],
      { ...routing, preferredProviders: ['claude'] },
      'worker',
      'high',
      makeEngine(),
      () => true,
      'claude'
    )
    expect(selection.ranked).toEqual(['codex', 'claude'])
    expect(selection.crossProvider).toEqual({ plannerProvider: 'claude', applied: true })
    expect(selection.rationale).toContain('cross-provider')
  })

  it('retains configured preference among providers different from the Planner', () => {
    const selection = selectProvider(
      ['claude', 'codex', 'antigravity'],
      { ...routing, preferredProviders: ['claude', 'antigravity'] },
      'worker',
      'low',
      makeEngine(),
      () => true,
      'claude'
    )
    expect(selection.ranked).toEqual(['antigravity', 'codex', 'claude'])
  })

  it.each([
    {
      available: ['claude'],
      crossProvider: true,
      planner: 'claude' as const,
      reason: 'one eligible'
    },
    {
      available: ['claude', 'codex'],
      crossProvider: false,
      planner: 'claude' as const,
      reason: 'disabled'
    },
    { available: ['claude', 'codex'], crossProvider: true, planner: null, reason: 'unknown' }
  ])('records why cross-provider was not applied: $reason', (input) => {
    const selection = selectProvider(
      input.available,
      { ...routing, crossProvider: input.crossProvider },
      'worker',
      'high',
      makeEngine(),
      () => true,
      input.planner
    )
    expect(selection.chosen).toBe('claude')
    expect(selection.crossProvider).toEqual({ plannerProvider: input.planner, applied: false })
    expect(selection.rationale).toContain(input.reason)
  })

  it('does not apply Worker cross-provider preference to a Planner', () => {
    const selection = selectProvider(
      ['claude', 'codex'],
      routing,
      'planner',
      'high',
      makeEngine(),
      () => true,
      'claude'
    )
    expect(selection.chosen).toBe('claude')
    expect(selection.crossProvider?.applied).toBe(false)
  })

  it('lets an explicit eligible role provider override cross-provider preference', () => {
    const selection = selectProvider(
      ['claude', 'codex'],
      { ...routing, roles: { worker: { provider: 'claude' } } },
      'worker',
      'high',
      makeEngine(),
      () => true,
      'claude'
    )
    expect(selection.chosen).toBe('claude')
    expect(selection.crossProvider).toEqual({ plannerProvider: 'claude', applied: false })
    expect(selection.rationale).toContain('role provider')
  })

  it('records the unavailable role provider and applies cross-provider fallback', () => {
    const selection = selectProvider(
      ['claude', 'codex', 'antigravity'],
      { ...routing, roles: { worker: { provider: 'codex' } }, disallowedProviders: ['codex'] },
      'worker',
      'medium',
      makeEngine(),
      () => true,
      'claude'
    )
    expect(selection.chosen).toBe('antigravity')
    expect(selection.roleProviderUnavailable).toBe('disallowed')
    expect(selection.filtered).toContainEqual({ provider: 'codex', reason: 'disallowed' })
    expect(selection.crossProvider?.applied).toBe(true)
  })
})

describe('certification and account policy', () => {
  it('requires certified combinations before considering disallowed providers', () => {
    const selection = selectProvider(
      ['claude', 'codex'],
      { ...routing, requireCertified: true, disallowedProviders: ['claude'] },
      'worker',
      'high',
      makeEngine()
    )
    expect(selection.ranked).toEqual(['codex'])
    expect(selection.filtered).toContainEqual({ provider: 'claude', reason: 'not_certified' })
  })

  it.each(['planner', 'worker'] as const)(
    'filters a Claude account before certification for %s',
    (role) => {
      const hasAccount = vi.fn((provider: string) => provider !== 'claude')
      const selection = selectProvider(
        ['claude', 'codex', 'gemini'],
        { ...routing, requireCertified: true, disallowedProviders: ['claude'] },
        role,
        'high',
        makeEngine(),
        hasAccount
      )
      expect(selection.chosen).toBe('codex')
      expect(selection.filtered).toEqual([
        { provider: 'opencode', reason: 'not_installed' },
        { provider: 'antigravity', reason: 'not_installed' },
        { provider: 'claude', reason: 'no_account' },
        { provider: 'gemini', reason: 'not_certified' }
      ])
      expect(hasAccount.mock.calls).toEqual([['claude'], ['codex']])
    }
  )

  it.each([
    ['claude', 'Claude'],
    ['codex', 'Codex']
  ])('names the missing %s account in admission errors', (provider, name) => {
    expect(() =>
      selectProvider([provider], routing, 'worker', 'high', makeEngine(), () => false)
    ).toThrow(`No ${name} account selected. Add a ${name} account in Settings › Accounts.`)
  })
})
