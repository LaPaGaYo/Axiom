import { resolveTuiAgentLaunchEnv } from '../../../shared/tui-agent-launch-defaults'
import type { StructuredAgentId } from '../../../shared/agent-session-provider-handle'
import { structuredAgentRuntimeMetadata } from '../structured-agent-runtime-metadata'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { OrcaRuntimeWithStructuredSessionCliWriterHost } from './structured-session-cli-writer-host'
import { getSelectedClaudeAccountIdForTarget } from '../../claude-accounts/runtime-selection'
import { requireLegacyAgentSessionAccountHome } from '../../../shared/agent-session-account-home'
import { describeClaudeProfile } from '../../claude-accounts/claude-profile-paths'
import { getClaudeProfileRouter } from '../../claude-accounts/claude-profile-installed-router'

export abstract class OrcaRuntimeWithStructuredSessionAccountHome extends OrcaRuntimeWithStructuredSessionCliWriterHost {
  async resolveClaudeHomeForWorkerLaunch(): Promise<string | null> {
    const accountId = getSelectedClaudeAccountIdForTarget(this.requireStore().getSettings(), {
      runtime: 'host'
    })
    if (!accountId) {
      return null
    }
    const resolve = this.structuredAgentAccountHomeResolver('claude', '', 'launch')
    if (!resolve) {
      return null
    }
    // An ambient/user override cannot replace the selected managed account.
    const home = await resolve({ launchEnv: {}, location: null })
    const resolved = requireLegacyAgentSessionAccountHome(home).path
    const selected =
      getClaudeProfileRouter()?.accountHome(accountId) ??
      describeClaudeProfile(getProfileUserDataPath(), accountId, {
        executionHostId: 'local',
        runtime: 'host'
      }).home
    // Legacy accounts covered by System default can resolve to the user's home. Mission
    // Workers require the selected managed home, with its exact Keychain path spelling.
    return resolved === selected ? resolved : null
  }

  resolveCodexHomeForWorkerLaunch(): string | null {
    if (!this.resolveCodexStructuredLaunchHomeFn) {
      throw new Error('Codex runtime home service is not initialized')
    }
    const home = this.resolveCodexStructuredLaunchHomeFn({
      launchEnv: resolveTuiAgentLaunchEnv(
        'codex',
        this.requireStore().getSettings().agentDefaultEnv
      )
    })
    if (home !== null && typeof home !== 'string') {
      throw new Error('Worker launch requires a synchronous Codex home resolver')
    }
    return home
  }

  /** Where a launch of `agent` finds its account, resolved on this host by the agent's own
   *  registration; null for an agent this runtime does not register, whose create is refused. */
  protected structuredAgentAccountHomeResolver(
    agent: StructuredAgentId,
    worktree: string,
    purpose: 'launch' | 'read',
    hostLaunchDirectory?: string
  ) {
    const registration = structuredAgentRuntimeMetadata(agent)
    if (!registration) {
      return null
    }
    return async ({ launchEnv, location }) =>
      registration.resolveAccountHome(
        {
          launchEnv,
          location: location ?? null,
          purpose,
          workspacePath:
            purpose === 'launch'
              ? async () =>
                  hostLaunchDirectory ??
                  (await this.resolveRuntimeFileTarget(worktree)).worktree.path
              : null
        },
        {
          getClaudeConfigDirectory: (target) => this.accounts.getClaudeConfigDirectory(target),
          prepareCodexLaunchHome: this.prepareCodexStructuredLaunchFn,
          readCodexLaunchHome: this.resolveCodexStructuredLaunchHomeFn,
          workspaceTrustSettings: () => this.requireStore().getSettings(),
          // The chat host's own state root (ensureStructuredAgentSessionHost).
          stateDirectory: getProfileUserDataPath()
        }
      )
  }
}
