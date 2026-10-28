import type { TuiAgent as TuiAgentId } from '../../../shared/tui-agent'

export type CertifiedProviderCombo = {
  provider: TuiAgentId
  model: 'launch-arg' | 'harness-default'
  endpointProfile: 'subscription'
  roles: readonly ('planner' | 'worker')[]
  maxRisk: 'low' | 'medium' | 'high'
  status: 'provisional' | 'certified'
  evidence?: string
  launchBaseline?: { harnessVersion: string; skills: readonly string[]; evidence: string }
}

// Why: D57 limits Attempts to these combos; evidence is added per combo after M2-07's host conformance e2e.
export const CERTIFIED_PROVIDER_COMBOS: readonly CertifiedProviderCombo[] = [
  {
    provider: 'claude',
    model: 'launch-arg',
    endpointProfile: 'subscription',
    roles: ['planner', 'worker'],
    // D57: high-risk Workers require sandbox.enabled and failIfUnavailable at launch.
    maxRisk: 'high',
    status: 'provisional',
    launchBaseline: {
      harnessVersion: '2.1.309',
      skills: ['doctor', 'plugin-authoring'],
      evidence: '.axiom-work/verifications/M3-08f-isolation-probe.md'
    }
  },
  {
    provider: 'codex',
    model: 'launch-arg',
    endpointProfile: 'subscription',
    roles: ['planner', 'worker'],
    maxRisk: 'high',
    // D57 revision 2026-10-26: sandboxed Worker RUNNING → SUBMITTED → VERIFIED and a structured-channel
    // Planner proposal from the D83 account home, egress recorded.
    status: 'certified',
    evidence: '.axiom-work/verifications/M3-08-smoke-real-codex.md'
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
