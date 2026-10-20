import type { TuiAgent as TuiAgentId } from '../../../shared/tui-agent'

export type CertifiedProviderCombo = {
  provider: TuiAgentId
  model: 'launch-arg' | 'harness-default'
  endpointProfile: 'subscription'
  roles: readonly ('planner' | 'worker')[]
  maxRisk: 'low' | 'medium' | 'high'
  status: 'provisional' | 'certified'
  evidence?: string
}

// Why: D57 limits Attempts to these combos; evidence is added per combo after M2-07's host conformance e2e.
export const CERTIFIED_PROVIDER_COMBOS: readonly CertifiedProviderCombo[] = [
  {
    provider: 'claude',
    model: 'launch-arg',
    endpointProfile: 'subscription',
    roles: ['planner', 'worker'],
    maxRisk: 'high',
    status: 'provisional'
  },
  {
    provider: 'codex',
    model: 'launch-arg',
    endpointProfile: 'subscription',
    roles: ['planner', 'worker'],
    maxRisk: 'high',
    status: 'provisional'
  },
  {
    provider: 'antigravity',
    model: 'launch-arg',
    endpointProfile: 'subscription',
    roles: ['worker'],
    maxRisk: 'medium',
    status: 'provisional'
  },
  {
    provider: 'opencode',
    model: 'harness-default',
    endpointProfile: 'subscription',
    roles: ['worker'],
    maxRisk: 'low',
    status: 'provisional'
  }
]

export function certifiedCombo(provider: string): CertifiedProviderCombo | undefined {
  return CERTIFIED_PROVIDER_COMBOS.find((combo) => combo.provider === provider)
}
