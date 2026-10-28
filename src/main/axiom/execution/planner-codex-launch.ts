import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AxiomStore } from '../db/axiom-store'
import type { ControlPlaneWorkerStart } from '../../runtime/rpc/methods/orchestration/worker/control-plane-worker-start'
import { resolveHostAgentBaseEnvironment } from '../../runtime/structured-agent-shell-environment'
import { registerCodexMissionSessionPins } from '../../codex/codex-mission-session-pins'
import type { AttemptLauncherDependencies } from './attempt-launcher'
import { harnessEgressEnv } from './harness-egress-env'

export function codexPlannerLaunchPolicy(
  deps: Pick<AttemptLauncherDependencies, 'store' | 'runtime' | 'resolveBaseEnvironment'>,
  spec: AgentSpec
): Pick<ControlPlaneWorkerStart, 'structured'> {
  if (spec.provider !== 'codex' || !['darwin', 'linux'].includes(process.platform)) {
    return {}
  }
  return {
    structured: {
      prepare: async ({ dispatchId, sessionId }) => {
        const { env, ...egress } = harnessEgressEnv({
          provider: 'codex',
          inherited: await (deps.resolveBaseEnvironment ?? resolveHostAgentBaseEnvironment)(
            deps.runtime.requireStore().getSettings()
          )
        })
        const dispose = registerCodexMissionSessionPins(dispatchId, sessionId, { env })
        try {
          deps.store.appendAuditEvent({
            missionId: spec.missionId,
            actor: 'MissionController',
            objectKind: 'attempt',
            objectId: dispatchId,
            event: 'attempt.egress_pinned',
            before: null,
            after: { provider: 'codex', channel: 'structured', ...egress }
          })
          return dispose
        } catch (error) {
          dispose()
          throw error
        }
      }
    }
  }
}

export function recordCodexPlannerTerminalEgress(
  store: AxiomStore,
  spec: AgentSpec,
  dispatchId: string
): void {
  if (spec.provider !== 'codex' || !['darwin', 'linux'].includes(process.platform)) {
    return
  }
  store.appendAuditEvent({
    missionId: spec.missionId,
    actor: 'MissionController',
    objectKind: 'attempt',
    objectId: dispatchId,
    event: 'attempt.egress_pinned',
    before: null,
    after: {
      provider: 'codex',
      channel: 'terminal',
      mode: 'unpinned-terminal',
      noProxy: [],
      blackhole: null,
      overrides: []
    }
  })
}
