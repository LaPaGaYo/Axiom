import { z } from 'zod'
import { TUI_AGENT_CONFIG, isTuiAgent } from '../../../shared/tui-agent-config'
import { AttachParams } from '../../../shared/rpc-contract/structured-agent-session-params'
import {
  ProviderFilterReasonSchema,
  type AgentSpec
} from '../../../shared/axiom-contract/agent-spec'
import { RISK_LEVELS, type RiskLevel } from '../../../shared/axiom-contract/lifecycle'
import type { AuditEvent, Policy } from '../../../shared/axiom-contract/mission-objects'
import type { DecisionContext, DecisionEngine } from '../decision-engine/decision-engine'
import type { DecisionRule } from '../decision-engine/rules-engine'
import { certifiedCombo } from './certified-providers'

// Why: Agent Teams is an Orca launch mode wrapping Claude, not an independent provider.
const EXCLUDED_LAUNCH_MODE = 'claude-agent-teams'
const DEFAULT_ORDER = Object.keys(TUI_AGENT_CONFIG).filter(isTuiAgent)
const isTierA = (provider: unknown) => AttachParams.shape.provider.safeParse(provider).success

function accountErrorMessage(filtered: AuditEvent['after'] | undefined) {
  if (!Array.isArray(filtered)) {
    return undefined
  }
  const messages = filtered.flatMap((entry) => {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      !('reason' in entry) ||
      entry.reason !== 'no_account' ||
      !('provider' in entry)
    ) {
      return []
    }
    const name =
      entry.provider === 'claude' ? 'Claude' : entry.provider === 'codex' ? 'Codex' : null
    return name
      ? [`No ${name} account selected. Add a ${name} account in Settings › Accounts.`]
      : []
  })
  return messages.join(' ') || undefined
}

export class AgentFactoryError extends Error {
  constructor(
    readonly code:
      | 'no_eligible_provider'
      | 'invalid_argument'
      | 'mission_not_found'
      | 'task_not_found'
      | 'goal_revision_not_found',
    readonly data: Record<string, AuditEvent['after']> = {}
  ) {
    super(accountErrorMessage(data.filtered) ?? code)
    this.name = 'AgentFactoryError'
  }
}

function preferredScore(candidate: unknown, context: DecisionContext) {
  const preferred = z.array(z.string()).parse(context.preferredProviders ?? [])
  const index = typeof candidate === 'string' ? preferred.indexOf(candidate) : -1
  return index < 0 ? undefined : 100 - index
}

export const PROVIDER_SELECTION_RULES: readonly DecisionRule[] = [
  {
    rationale: 'Mission role provider',
    score: (candidate, context) => (candidate === context.roleProvider ? 400 : undefined)
  },
  {
    rationale: 'Worker cross-provider preference',
    score: (candidate, context) => {
      if (!context.crossProvider || candidate === context.plannerProvider) {
        return undefined
      }
      const preferred = preferredScore(candidate, context)
      return 200 + (preferred === undefined ? (isTierA(candidate) ? 1 : 0) : Math.max(2, preferred))
    }
  },
  {
    rationale: 'Mission preferredProviders order',
    score: preferredScore
  },
  {
    rationale: 'tier A before B; ties use TUI_AGENT_CONFIG order',
    score: (candidate) => (isTierA(candidate) ? 1 : 0)
  }
]

export function selectProvider(
  available: string[],
  routing: Policy['routing'],
  role: AgentSpec['role'],
  risk: RiskLevel,
  engine: DecisionEngine,
  hasAccount: (provider: string) => boolean = () => true,
  plannerProvider: AgentSpec['provider'] | null = null
): AgentSpec['selection'] {
  const installed = DEFAULT_ORDER.filter(
    (id) => id !== EXCLUDED_LAUNCH_MODE && available.includes(id)
  )
  const filtered: AgentSpec['selection']['filtered'] = []
  const roleProvider = routing.roles[role]?.provider
  const candidates = DEFAULT_ORDER.filter((provider) => {
    const combo = certifiedCombo(provider)
    if (!combo && !installed.includes(provider) && provider !== roleProvider) {
      return false
    }
    const reason = !available.includes(provider)
      ? 'not_installed'
      : (provider === 'codex' || provider === 'claude') && !hasAccount(provider)
        ? 'no_account'
        : !combo || (routing.requireCertified && combo.status !== 'certified')
          ? 'not_certified'
          : routing.disallowedProviders.includes(provider)
            ? 'disallowed'
            : !combo.roles.includes(role) ||
                RISK_LEVELS.indexOf(risk) > RISK_LEVELS.indexOf(combo.maxRisk) ||
                (risk === 'high' && routing.highRiskTier === 'A' && !isTierA(provider))
              ? 'tier_too_low'
              : undefined
    if (reason) {
      filtered.push({ provider, reason })
    }
    return !reason
  })
  // Why: D57 audit order follows filter precedence, retaining config order within each reason.
  filtered.sort(
    (a, b) =>
      ProviderFilterReasonSchema.options.indexOf(a.reason) -
      ProviderFilterReasonSchema.options.indexOf(b.reason)
  )
  const roleProviderUnavailable = filtered.find((entry) => entry.provider === roleProvider)?.reason
  const roleEvidence = roleProviderUnavailable ? { roleProviderUnavailable } : {}
  if (!candidates.length) {
    const data: Record<string, AuditEvent['after']> = { installed, filtered }
    if (roleProviderUnavailable) {
      data.roleProviderUnavailable = roleProviderUnavailable
    }
    throw new AgentFactoryError('no_eligible_provider', data)
  }
  const crossReason =
    role !== 'worker'
      ? 'Planner role'
      : !routing.crossProvider
        ? 'disabled'
        : !plannerProvider
          ? 'Planner provider unknown'
          : candidates.length < 2
            ? 'only one eligible provider'
            : candidates.some((provider) => provider === roleProvider)
              ? 'explicit role provider takes precedence'
              : null
  const { ranked, rationale } = engine.rank({
    candidates,
    context: {
      preferredProviders: routing.preferredProviders,
      filtered,
      roleProvider: roleProvider ?? null,
      plannerProvider,
      crossProvider: crossReason === null
    }
  })
  // An advisory engine must return exactly the eligible set, even if a replacement misbehaves.
  if (
    ranked.length !== candidates.length ||
    new Set(ranked).size !== candidates.length ||
    ranked.some((id) => !candidates.includes(id))
  ) {
    throw new AgentFactoryError('invalid_argument', { reason: 'invalid_provider_ranking' })
  }
  const applied = crossReason === null && ranked[0] !== plannerProvider
  const crossDecision = applied
    ? `applied against Planner ${plannerProvider}`
    : `not applied: ${crossReason ?? 'engine retained Planner provider'}`
  return {
    installed,
    filtered,
    ranked,
    chosen: ranked[0],
    rationale: `${rationale}; cross-provider ${crossDecision}`,
    crossProvider: { plannerProvider, applied },
    ...roleEvidence
  }
}
