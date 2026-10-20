import { z } from 'zod'
import { TUI_AGENT_CONFIG, isTuiAgent } from '../../../shared/tui-agent-config'
import { AttachParams } from '../../../shared/rpc-contract/structured-agent-session-params'
import {
  ProviderFilterReasonSchema,
  type AgentSpec
} from '../../../shared/axiom-contract/agent-spec'
import { RISK_LEVELS, type RiskLevel } from '../../../shared/axiom-contract/lifecycle'
import type { Policy } from '../../../shared/axiom-contract/mission-objects'
import type { DecisionEngine } from '../decision-engine/decision-engine'
import type { DecisionRule } from '../decision-engine/rules-engine'
import { certifiedCombo } from './certified-providers'

// Why: Agent Teams is an Orca launch mode wrapping Claude, not an independent provider.
const EXCLUDED_LAUNCH_MODE = 'claude-agent-teams'
const DEFAULT_ORDER = Object.keys(TUI_AGENT_CONFIG)
  .filter(isTuiAgent)
  .filter((id) => id !== EXCLUDED_LAUNCH_MODE)
const isTierA = (provider: unknown) => AttachParams.shape.provider.safeParse(provider).success

export class AgentFactoryError extends Error {
  constructor(
    readonly code:
      | 'no_eligible_provider'
      | 'invalid_argument'
      | 'mission_not_found'
      | 'task_not_found'
      | 'goal_revision_not_found',
    readonly data: Record<string, unknown> = {}
  ) {
    super(code)
    this.name = 'AgentFactoryError'
  }
}

export const PROVIDER_SELECTION_RULES: readonly DecisionRule[] = [
  {
    rationale: 'Mission preferredProviders order',
    score: (candidate, context) => {
      const preferred = z.array(z.string()).parse(context.preferredProviders ?? [])
      const index = typeof candidate === 'string' ? preferred.indexOf(candidate) : -1
      return index < 0 ? undefined : 100 - index
    }
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
  engine: DecisionEngine
): AgentSpec['selection'] {
  const installed = DEFAULT_ORDER.filter((id) => available.includes(id))
  const filtered: AgentSpec['selection']['filtered'] = []
  const candidates = DEFAULT_ORDER.filter((provider) => {
    const combo = certifiedCombo(provider)
    if (!combo && !installed.includes(provider)) {
      return false
    }
    const reason = !installed.includes(provider)
      ? 'not_installed'
      : !combo
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
  if (!candidates.length) {
    throw new AgentFactoryError('no_eligible_provider', { installed, filtered })
  }
  const { ranked, rationale } = engine.rank({
    candidates,
    context: { preferredProviders: routing.preferredProviders, filtered }
  })
  // An advisory engine must return exactly the eligible set, even if a replacement misbehaves.
  if (
    ranked.length !== candidates.length ||
    new Set(ranked).size !== candidates.length ||
    ranked.some((id) => !candidates.includes(id))
  ) {
    throw new AgentFactoryError('invalid_argument', { reason: 'invalid_provider_ranking' })
  }
  return { installed, filtered, ranked, chosen: ranked[0], rationale }
}
