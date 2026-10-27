import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { AgentSpec } from '../../../shared/axiom-contract/agent-spec'
import type { AxiomStore } from '../db/axiom-store'
import type { ControlPlaneWorkerStart } from '../../runtime/rpc/methods/orchestration/worker/control-plane-worker-start'
import { readCodexAccountHomeAllowlist } from '../../codex/codex-worker-launch-home'
import { plannerProposalCommandPrefix } from '../context-builder/planner-render'
import { headlessAttemptDirectory } from './headless-attempt-files'
import { claudeIsolationSettings, CLAUDE_LAUNCH_ENV } from './claude-launch-policy'
import { registerClaudeMissionSessionPins } from '../../claude/claude-mission-session-pins'
import type { AttemptLauncherDependencies } from './attempt-launcher'
import { ClaudeAccountRequiredError } from '../../claude-accounts/claude-account-required-error'

export function claudePlannerLaunchPolicy(
  deps: Pick<AttemptLauncherDependencies, 'store' | 'runtime'>,
  spec: AgentSpec
): Pick<ControlPlaneWorkerStart, 'structured'> {
  return spec.provider === 'claude'
    ? {
        structured: createClaudePlannerLaunch({
          store: deps.store,
          missionId: spec.missionId,
          model: spec.model,
          effort: spec.reasoning.effort,
          resolveAccountHome: async () =>
            (await deps.runtime.resolveClaudeHomeForWorkerLaunch?.()) ?? null,
          settings: () => deps.runtime.requireStore().getSettings()
        })
      }
    : {}
}

export function createClaudePlannerLaunch(input: {
  store: AxiomStore
  missionId: string
  model: string
  effort: AgentSpec['reasoning']['effort']
  settings: () => unknown
  resolveAccountHome: () => Promise<string | null>
}): NonNullable<ControlPlaneWorkerStart['structured']> {
  return {
    prepare: async ({ dispatchId, sessionId }) => {
      // These ids enter a CLI permission prefix, where shell or rule metacharacters are invalid.
      const id = z.string().regex(/^[\w-]+$/)
      id.parse(input.missionId)
      id.parse(dispatchId)
      const accountHomePath = await input.resolveAccountHome()
      if (!accountHomePath) {
        throw new ClaudeAccountRequiredError()
      }
      const directory = headlessAttemptDirectory(dispatchId)
      const settingsPath = path.join(directory, 'planner-settings.json')
      const { skills } = readCodexAccountHomeAllowlist(input.settings())
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await writeFile(
        settingsPath,
        JSON.stringify({
          ...claudeIsolationSettings(),
          permissions: {
            allow: [
              'Read',
              'Grep',
              'Glob',
              'LS',
              'Bash(git log:*)',
              'Bash(git diff:*)',
              'Bash(git show:*)',
              `Bash(${plannerProposalCommandPrefix(input.missionId, dispatchId)}:*)`
            ],
            deny: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit', 'WebFetch', 'WebSearch']
          }
        }),
        { mode: 0o600, flag: 'wx' }
      )
      return registerClaudeMissionSessionPins(dispatchId, sessionId, {
        settingsPath,
        env: CLAUDE_LAUNCH_ENV,
        accountHomePath,
        skills,
        ...(input.model === 'policy-default' ? {} : { model: input.model }),
        effort: input.effort,
        denyPermission: (toolName) => {
          try {
            input.store.appendAuditEvent({
              missionId: input.missionId,
              actor: 'MissionController',
              objectKind: 'attempt',
              objectId: dispatchId,
              event: 'attempt.permission_denied',
              before: null,
              after: {
                toolName: /^[\w.:-]{1,128}$/.test(toolName) ? toolName : 'unknown',
                summary: 'Mission Planner denied a tool request outside its allow rules.'
              }
            })
          } catch {
            // Losing an audit must never turn a deny into a pending or authorized tool call.
            console.warn('[axiom] Planner permission denial audit unavailable', { dispatchId })
          }
        }
      })
    }
  }
}
