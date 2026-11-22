import { z } from 'zod'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TUI_AGENT_CONFIG, isTuiAgent } from '../../../shared/tui-agent-config'
import {
  RoutingPolicySchema,
  TuiAgentIdSchema
} from '../../../shared/axiom-contract/mission-objects'
import { ProviderFilterReasonSchema } from '../../../shared/axiom-contract/agent-spec'
import { ProviderEligibilitySchema } from '../../../shared/axiom-contract/policy-params'
import {
  goal,
  policy,
  provenance
} from '../../../shared/axiom-contract/contract-fixtures.test-support'
import { OrchestrationDb } from '../../runtime/orchestration/db/orchestration-db'
import { AxiomStore } from '../db/axiom-store'
import { MissionController } from '../mission-controller/mission-controller'
import { RulesEngine } from '../decision-engine/rules-engine'
import { AgentFactory } from './agent-factory'
import {
  AgentFactoryError,
  PROVIDER_SELECTION_RULES,
  providerEligibility,
  selectProvider
} from './provider-selection'

const slots = [
  { role: 'planner', risk: 'high' },
  { role: 'worker', risk: 'low' },
  { role: 'worker', risk: 'medium' },
  { role: 'worker', risk: 'high' }
] as const
const order = Object.keys(TUI_AGENT_CONFIG).filter(isTuiAgent)
const cooldown = new Map([['codex', '2026-11-21T13:00:00.000Z']])
const FilteredSchema = z.array(
  z.strictObject({ provider: TuiAgentIdSchema, reason: ProviderFilterReasonSchema })
)
let db: OrchestrationDb
let store: AxiomStore
let missionId: string
let goalRevisionId: string

beforeEach(() => {
  db = new OrchestrationDb(':memory:')
  store = new AxiomStore(db)
  const created = new MissionController(db, store).createMission({
    repoId: 'repo',
    repoPath: '/fixture',
    targetBranch: 'main',
    goal,
    policy,
    provenance
  })
  missionId = created.mission.id
  goalRevisionId = created.goalRevision.id
})
afterEach(() => {
  vi.restoreAllMocks()
  db.close()
})

it('answers each provider and slot with what selection filters', () => {
  const cases = [
    { available: [], accounts: [], routing: {}, cooldown: new Map() },
    {
      available: ['codex', 'claude', 'opencode', 'antigravity', 'gemini'],
      accounts: ['codex', 'claude'],
      routing: {},
      cooldown: new Map()
    },
    {
      available: ['codex', 'claude', 'gemini'],
      accounts: [],
      routing: { disallowedProviders: ['codex'], requireCertified: true },
      cooldown
    },
    {
      available: ['codex', 'claude', 'antigravity'],
      accounts: ['codex'],
      routing: { requireCertified: true, disallowedProviders: ['antigravity'] },
      cooldown
    },
    {
      available: ['opencode', 'antigravity'],
      accounts: [],
      routing: { highRiskTier: 'A', roles: { planner: { provider: 'gemini' } } },
      cooldown
    },
    {
      available: ['codex', 'claude'],
      accounts: ['codex', 'claude'],
      routing: { roles: { worker: { provider: 'codex' } }, preferredProviders: ['codex'] },
      cooldown
    },
    {
      available: ['codex'],
      accounts: ['codex'],
      routing: { disallowedProviders: ['codex'] },
      cooldown
    },
    {
      available: ['claude-agent-teams', 'codex'],
      accounts: ['codex'],
      routing: { roles: { worker: { provider: 'claude-agent-teams' } } },
      cooldown: new Map()
    }
  ]
  for (const input of cases) {
    const routing = RoutingPolicySchema.parse(input.routing)
    const accounts = new Set<string>(input.accounts)
    const hasAccount = (provider: string) => accounts.has(provider)
    const answer = providerEligibility(input.available, routing, hasAccount, input.cooldown)
    expect(z.array(ProviderEligibilitySchema).parse(answer)).toEqual(answer)
    const seen = new Set<string>()
    for (const { role, risk } of slots) {
      const engine = new RulesEngine(PROVIDER_SELECTION_RULES)
      const rank = vi.spyOn(engine, 'rank')
      let ranked: string[] = []
      let filtered: z.infer<typeof FilteredSchema> = []
      try {
        const selection = selectProvider(
          input.available,
          routing,
          role,
          risk,
          engine,
          hasAccount,
          null,
          role === 'worker' ? input.cooldown : new Map()
        )
        ranked = selection.ranked
        filtered = selection.filtered
        expect(rank).toHaveBeenCalledOnce()
      } catch (error) {
        expect(error).toBeInstanceOf(AgentFactoryError)
        if (!(error instanceof AgentFactoryError)) {
          throw error
        }
        expect(error.code).toBe('no_eligible_provider')
        filtered = FilteredSchema.parse(error.data.filtered)
        expect(rank).not.toHaveBeenCalled()
      }
      for (const provider of [...ranked, ...filtered.map((entry) => entry.provider)]) {
        seen.add(provider)
      }
      const eligible = answer
        .filter((entry) => (role === 'planner' ? entry.planner : entry.worker[risk]).eligible)
        .map((entry) => entry.provider)
      expect(eligible).toEqual(order.filter((provider) => ranked.includes(provider)))
      for (const entry of answer) {
        const value = role === 'planner' ? entry.planner : entry.worker[risk]
        const reason = filtered.find((item) => item.provider === entry.provider)?.reason
        expect(value).toEqual({
          eligible: ranked.includes(entry.provider),
          ...(reason ? { reason } : {})
        })
      }
    }
    expect(answer.map((entry) => entry.provider)).toEqual(
      order.filter((provider) => seen.has(provider))
    )
  }
})

it('leaves a provider outside a slot not eligible and without a reason', () => {
  const routing = RoutingPolicySchema.parse({ roles: { planner: { provider: 'gemini' } } })
  const answer = providerEligibility([], routing, () => true, new Map())
  expect(answer.find((entry) => entry.provider === 'gemini')).toEqual({
    provider: 'gemini',
    planner: { eligible: false, reason: 'not_installed' },
    worker: { low: { eligible: false }, medium: { eligible: false }, high: { eligible: false } }
  })
  expect(answer.some((entry) => entry.provider === 'continue')).toBe(false)
  const entry = answer[0]
  expect(entry).toBeDefined()
  if (!entry) {
    throw new Error('missing eligibility entry')
  }
  for (const invalid of [
    { ...entry, extra: true },
    { ...entry, provider: 'absent-provider' },
    { ...entry, planner: { eligible: false, reason: 'unknown' } },
    { ...entry, planner: { eligible: false, extra: true } },
    { ...entry, worker: { ...entry.worker, extra: { eligible: true } } },
    { ...entry, worker: { ...entry.worker, low: { eligible: true, extra: true } } },
    { ...entry, worker: { low: entry.worker.low } }
  ]) {
    expect(ProviderEligibilitySchema.safeParse(invalid).success).toBe(false)
  }
})

it('asks the Planner slot the way the factory selects a Planner', async () => {
  const routing = RoutingPolicySchema.parse({
    roles: { planner: { provider: 'codex' } },
    highRiskTier: 'A'
  })
  store.upsertPolicy(missionId, { ...store.getPolicy(missionId)!, routing })
  const factory = new AgentFactory(
    store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    async () => ['codex', 'claude', 'antigravity', 'opencode'],
    (provider) => provider !== 'claude',
    async () => cooldown
  )
  const answer = await factory.providerEligibility(missionId)
  const { spec } = await factory.build({ missionId, role: 'planner', goalRevisionId })
  expect(answer.filter((entry) => entry.planner.eligible).map((entry) => entry.provider)).toEqual(
    order.filter((provider) => spec.selection.ranked.includes(provider))
  )
  for (const { provider, reason } of spec.selection.filtered) {
    expect(answer.find((entry) => entry.provider === provider)?.planner).toEqual({
      eligible: false,
      reason
    })
  }
  expect(answer.find((entry) => entry.provider === 'codex')?.planner).toEqual({ eligible: true })
  expect(answer.find((entry) => entry.provider === 'codex')?.worker.high).toEqual({
    eligible: false,
    reason: 'account_cooldown'
  })
})

it('reads the installed providers and the cooldown once and refuses a Mission that does not exist', async () => {
  const installed = vi.fn(async () => ['codex'])
  const cooling = vi.fn(async () => cooldown)
  const factory = new AgentFactory(
    store,
    new RulesEngine(PROVIDER_SELECTION_RULES),
    installed,
    () => true,
    cooling
  )
  const before = store.listAuditEvents({ missionId })
  for (let count = 1; count <= 2; count++) {
    await factory.providerEligibility(missionId)
    expect(installed).toHaveBeenCalledTimes(count)
    expect(cooling).toHaveBeenCalledTimes(count)
  }
  expect(store.listAuditEvents({ missionId })).toEqual(before)
  expect(store.listAgentSpecs(missionId)).toEqual([])
  await expect(factory.providerEligibility('absent')).rejects.toMatchObject({
    code: 'mission_not_found',
    data: { missionId: 'absent' }
  })
  db.db.prepare('DELETE FROM mission_policies WHERE mission_id = ?').run(missionId)
  await expect(factory.providerEligibility(missionId)).rejects.toMatchObject({
    code: 'mission_not_found',
    data: { missionId }
  })
})
