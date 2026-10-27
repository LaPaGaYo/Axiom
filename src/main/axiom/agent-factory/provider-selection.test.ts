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
        context: { preferredProviders: preferred, filtered: selection.filtered }
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
      false
    )
    expect(selection.chosen).toBe('claude')
    expect(selection.filtered).toEqual([
      { provider: 'opencode', reason: 'not_installed' },
      { provider: 'antigravity', reason: 'not_installed' },
      { provider: 'codex', reason: 'no_account' },
      { provider: 'gemini', reason: 'not_certified' }
    ])
    expect(
      selectProvider(['claude'], routing, role, 'high', makeEngine(), false).filtered
    ).toContainEqual({ provider: 'codex', reason: 'not_installed' })
  }
)
